import {GraphQLID, GraphQLNonNull} from 'graphql'
import AddSlackAuthPayload from 'server/graphql/types/AddSlackAuthPayload'
import {getUserId, isTeamMember} from 'server/utils/authorization'
import getRethink from '../../database/rethinkDriver'
import SlackManager from '../../utils/SlackManager'
import standardError from '../../utils/standardError'
import publish from 'server/utils/publish'
import {TEAM} from 'universal/utils/constants'
import {GQLContext} from 'server/graphql/graphql'
import SlackNotification from 'server/database/types/SlackNotification'
import SlackAuth from 'server/database/types/SlackAuth'

export default {
  name: 'AddSlackAuth',
  type: new GraphQLNonNull(AddSlackAuthPayload),
  args: {
    code: {
      type: new GraphQLNonNull(GraphQLID)
    },
    teamId: {
      type: new GraphQLNonNull(GraphQLID)
    }
  },
  resolve: async (
    _source,
    {code, teamId},
    {authToken, dataLoader, socketId: mutatorId}: GQLContext
  ) => {
    const viewerId = getUserId(authToken)
    const operationId = dataLoader.share()
    const subOptions = {mutatorId, operationId}

    // AUTH
    if (!isTeamMember(authToken, teamId)) {
      return standardError(new Error('Attempted teamId spoof'), {userId: viewerId})
    }

    // RESOLUTION
    const r = getRethink()

    const manager = await SlackManager.init(code)
    const {accessToken, webhook} = manager

    if (webhook) {
      const existingTeamNotificationsCount = await r
        .table('SlackNotification')
        .getAll(teamId, {index: 'teamId'})
        .filter({isActive: true})
        .count()
      if (existingTeamNotificationsCount === 0) {
        // kick off some reasonable defaults if they're the first on the team to integration, else nothing
        console.log('webhook', webhook)
        const {channel_id} = webhook
        const notifications = [
          new SlackNotification('meetingStart', channel_id, teamId, viewerId),
          new SlackNotification('meetingEnd', channel_id, teamId, viewerId)
        ]
        await r.table('SlackNotification').insert(notifications)
      }
    }

    const existingAuth = await r
      .table('SlackAuth')
      .getAll(viewerId, {index: 'userId'})
      .filter({teamId})
      .nth(0)
      .default(null)
    const slackAuth = new SlackAuth(accessToken, teamId, viewerId)
    if (existingAuth) {
      slackAuth.id = existingAuth.id
      slackAuth.createdAt = existingAuth.createdAt
      await r
        .table('SlackAuth')
        .get(slackAuth.id)
        .update(slackAuth)
    } else {
      await r.table('SlackAuth').insert(slackAuth)
    }

    const data = {slackAuthId: slackAuth.id}
    publish(TEAM, teamId, AddSlackAuthPayload, data, subOptions)
    return data
  }
}
