import React from 'react'
import MenuItem from 'universal/components/MenuItem'
import Menu from 'universal/components/Menu'
import useAtmosphere from 'universal/hooks/useAtmosphere'
import {MenuProps} from 'universal/hooks/useMenu'
import RemoveSlackAuthMutation from 'universal/mutations/RemoveGitHubAuthMutation'
import {IntegrationServiceEnum} from 'universal/types/graphql'
import handleOpenOAuth from 'universal/utils/handleOpenOAuth'
import {MenuMutationProps} from 'universal/utils/relay/withMutationProps'

interface Props {
  menuProps: MenuProps
  mutationProps: MenuMutationProps
  teamId: string
}

const SlackConfigMenu = (props: Props) => {
  const {menuProps, mutationProps, teamId} = props
  const {onError, onCompleted, submitMutation, submitting} = mutationProps
  const atmosphere = useAtmosphere()
  const openOAuth = handleOpenOAuth({
    name: IntegrationServiceEnum.SlackIntegration,
    atmosphere,
    teamId,
    ...mutationProps
  })

  const removeSlack = () => {
    if (submitting) return
    submitMutation()
    RemoveSlackAuthMutation(atmosphere, {teamId}, {onCompleted, onError})
  }
  return (
    <Menu ariaLabel={'Configure your Slack integration'} {...menuProps}>
      <MenuItem label='Refresh token' onClick={openOAuth} />
      <MenuItem label='Remove Slack' onClick={removeSlack} />
    </Menu>
  )
}

export default SlackConfigMenu
