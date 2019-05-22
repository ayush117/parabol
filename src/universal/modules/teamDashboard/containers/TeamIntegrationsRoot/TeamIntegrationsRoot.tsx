import React from 'react'
import {graphql} from 'react-relay'
import {RouteComponentProps, withRouter} from 'react-router'
import QueryRenderer from 'universal/components/QueryRenderer/QueryRenderer'
import ProviderList from 'universal/modules/teamDashboard/components/ProviderList/ProviderList'
import {cacheConfig} from 'universal/utils/constants'
import fromTeamMemberId from 'universal/utils/relay/fromTeamMemberId'
import renderQuery from 'universal/utils/relay/renderQuery'
import useAtmosphere from '../../../../hooks/useAtmosphere'
import {LoaderSize} from 'universal/types/constEnums'

const teamIntegrationsQuery = graphql`
  query TeamIntegrationsRootQuery($teamId: ID!) {
    viewer {
      ...ProviderList_viewer
    }
  }
`

interface Props extends RouteComponentProps<{}> {
  teamMemberId: string
}

const TeamIntegrationsRoot = ({history, teamMemberId}: Props) => {
  const {teamId} = fromTeamMemberId(teamMemberId)
  const atmosphere = useAtmosphere()
  return (
    <QueryRenderer
      cacheConfig={cacheConfig}
      environment={atmosphere}
      query={teamIntegrationsQuery}
      variables={{teamId}}
      subParams={{teamId, history}}
      render={renderQuery(ProviderList, {props: {teamId}, size: LoaderSize.PANEL})}
    />
  )
}

export default withRouter(TeamIntegrationsRoot)
