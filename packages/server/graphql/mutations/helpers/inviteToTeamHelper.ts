import appOrigin from '../../../appOrigin'
import {SubscriptionChannel, Threshold} from '../../../../client/types/constEnums'
import {isNotNull} from '../../../../client/utils/predicates'
import getRethink from '../../../database/rethinkDriver'
import NotificationTeamInvitation from '../../../database/types/NotificationTeamInvitation'
import TeamInvitation from '../../../database/types/TeamInvitation'
import teamInviteEmailCreator from '../../../email/teamInviteEmailCreator'
import {getUsersByEmails} from '../../../postgres/queries/getUsersByEmails'
import removeSuggestedAction from '../../../safeMutations/removeSuggestedAction'
import {getUserId} from '../../../utils/authorization'
import getBestInvitationMeeting from '../../../utils/getBestInvitationMeeting'
import getDomainFromEmail from '../../../utils/getDomainFromEmail'
import standardError from '../../../utils/standardError'
import {DataLoaderWorker, GQLContext} from '../../graphql'
import getIsEmailApprovedByOrg from '../../public/mutations/helpers/getIsEmailApprovedByOrg'
import makeAppURL from '../../../../client/utils/makeAppURL'
import {EMAIL_CORS_OPTIONS} from '../../../../client/types/cors'
import getMailManager from '../../../email/getMailManager'
import {analytics} from '../../../utils/analytics/analytics'
import util from 'util'
import crypto from 'crypto'
import publish from '../../../utils/publish'

const randomBytes = util.promisify(crypto.randomBytes)

const getInviteTrustScore = async (
  userId: string,
  teamId: string,
  inviteeEmails: string[],
  dataLoader: DataLoaderWorker
) => {
  const r = await getRethink()
  // hardcoded list of trouble domains. we can move to a DB table later if needed
  const untrustedDomains = ['tempmail.cn', 'qq.com']

  // do not trust inviters from untrusted domains
  const user = await dataLoader.get('users').loadNonNull(userId)
  const {email} = user
  const userDomain = getDomainFromEmail(email).toLowerCase()
  const isUntrustedDomain = untrustedDomains.includes(userDomain)
  if (isUntrustedDomain) return 0.05

  // do not trust invites going to invitees from untrusted domains
  const inviteeDomains = inviteeEmails.map((inviteeEmail) =>
    getDomainFromEmail(inviteeEmail).toLowerCase()
  )
  const overlapped =
    inviteeDomains.filter((domain: string) => untrustedDomains.includes(domain)).length > 0
  if (overlapped) return 0.05

  const [total, pending] = await Promise.all([
    r.table('TeamInvitation').getAll(teamId, {index: 'teamId'}).count().run(),
    r
      .table('TeamInvitation')
      .getAll(teamId, {index: 'teamId'})
      .filter({acceptedAt: null})
      .count()
      .run()
  ])
  // trust their first 10 invites
  if (total <= 10) return 0.95
  const accepted = total - pending
  // if no one has accepted one of their 10+ invites, don't trust them
  if (accepted === 0) return 0.05
  // the more folks accept their invite, the more trust they get
  return accepted / total
}

const inviteToTeamHelper = async (
  invitees: string[],
  teamId: string,
  meetingId: string | null | undefined,
  context: GQLContext
) => {
  const {authToken, dataLoader, socketId: mutatorId} = context
  const viewerId = getUserId(authToken)
  const r = await getRethink()
  const operationId = dataLoader.share()
  const subOptions = {mutatorId, operationId}

  const trustScore = await getInviteTrustScore(viewerId, teamId, invitees, dataLoader)
  if (trustScore < 0.15)
    return {error: {message: 'Cannot invite by email. Try using invite link'}, invitees: []}
  const [users, team, inviter] = await Promise.all([
    getUsersByEmails(invitees),
    dataLoader.get('teams').load(teamId),
    dataLoader.get('users').load(viewerId)
  ])
  if (!inviter) {
    return standardError(new Error('User not found'), {userId: viewerId})
  }
  if (!team) {
    return standardError(new Error('Team not found'), {userId: viewerId})
  }

  const {name: teamName, createdAt, isOnboardTeam, orgId} = team
  const organization = await dataLoader.get('organizations').load(orgId)
  const {tier, name: orgName} = organization
  const uniqueInvitees = Array.from(new Set(invitees as string[]))
  // filter out emails already on team
  const newInvitees = uniqueInvitees.filter((email) => {
    const user = users.find((user) => user.email === email)
    return !(user && user.tms && user.tms.includes(teamId))
  })

  // filter out invitees that aren't approved by the org
  const approvalErrors = await Promise.all(
    newInvitees.map((email) => {
      return getIsEmailApprovedByOrg(email, orgId, dataLoader)
    })
  )
  const newAllowedInvitees = newInvitees
    .map((invitee, idx) => {
      return approvalErrors[idx] instanceof Error ? undefined : invitee
    })
    .filter(isNotNull)
  const tokens = await Promise.all(
    newAllowedInvitees.map(async () => (await randomBytes(48)).toString('hex'))
  )
  const expiresAt = new Date(Date.now() + Threshold.TEAM_INVITATION_LIFESPAN)
  // insert invitation records
  const teamInvitationsToInsert = newAllowedInvitees.map((email, idx) => {
    return new TeamInvitation({
      expiresAt,
      email,
      invitedBy: viewerId,
      meetingId: meetingId ?? undefined,
      teamId,
      token: tokens[idx]!
    })
  })
  await r.table('TeamInvitation').insert(teamInvitationsToInsert).run()

  // remove suggested action, if any
  let removedSuggestedActionId
  if (isOnboardTeam) {
    removedSuggestedActionId = await removeSuggestedAction(viewerId, 'inviteYourTeam')
  }
  // insert notification records
  const notificationsToInsert = [] as NotificationTeamInvitation[]
  teamInvitationsToInsert.forEach((invitation) => {
    const user = users.find((user) => user.email === invitation.email)
    if (user) {
      notificationsToInsert.push(
        new NotificationTeamInvitation({
          userId: user.id,
          invitationId: invitation.id,
          teamId
        })
      )
    }
  })
  if (notificationsToInsert.length > 0) {
    await r.table('Notification').insert(notificationsToInsert).run()
  }

  const bestMeeting = await getBestInvitationMeeting(teamId, meetingId ?? undefined, dataLoader)

  // send emails
  const searchParams = {
    utm_source: 'invite email',
    utm_medium: 'email',
    utm_campaign: 'invitations'
  }
  const options = {searchParams}
  const emailResults = await Promise.all(
    teamInvitationsToInsert.map((invitation) => {
      const user = users.find((user) => user.email === invitation.email)
      const {html, subject, body} = teamInviteEmailCreator({
        appOrigin,
        inviteLink: makeAppURL(appOrigin, `team-invitation/${invitation.token}`, options),
        inviteeName: user ? user.preferredName : '',
        inviteeEmail: invitation.email,
        inviterName: inviter.preferredName,
        inviterEmail: inviter.email,
        teamName,
        meeting: bestMeeting,
        corsOptions: EMAIL_CORS_OPTIONS
      })
      return getMailManager().sendEmail({
        to: invitation.email,
        html,
        subject,
        body,
        tags: [
          'type:teamInvitation',
          `tier:${tier}`,
          `team:${teamName}:${orgName}:${teamId}:${orgId}`
        ]
      })
    })
  )

  const parabolUserEmails = users.map(({email}) => email)
  const inviteTo = meetingId ? 'meeting' : 'team'
  const now = new Date()
  const tenSecondsAgo = new Date(now.getTime() - 10 * 1000)
  const isInvitedOnCreation = createdAt > tenSecondsAgo // if the team was created in the last 10 seconds, we assume the invite was sent on creation
  newAllowedInvitees.forEach(async (inviteeEmail, idx) => {
    const isInviteeParabolUser = parabolUserEmails.includes(inviteeEmail)
    const success = !!emailResults[idx]
    analytics.inviteEmailSent(
      viewerId,
      teamId,
      inviteeEmail,
      isInviteeParabolUser,
      inviteTo,
      success,
      isInvitedOnCreation
    )
  })
  const successfulInvitees = newAllowedInvitees.filter((_email, idx) => emailResults[idx])
  const data = {
    removedSuggestedActionId,
    teamId,
    invitees: successfulInvitees
  }

  // Tell each invitee
  notificationsToInsert.forEach((notification) => {
    const {userId, id: teamInvitationNotificationId} = notification
    const subscriberData = {
      ...data,
      teamInvitationNotificationId
    }
    publish(
      SubscriptionChannel.NOTIFICATION,
      userId,
      'InviteToTeamPayload',
      subscriberData,
      subOptions
    )
  })

  return {
    removedSuggestedActionId,
    invitees: successfulInvitees,
    teamId
  }
}

export default inviteToTeamHelper
