import GraphQL, { GraphQLOptions } from "./datasources/GraphQL"
import { IDataSource } from "./types"
import { resetDataSources, refreshDataSources } from "./model/dataSourceManager"
import { getAllDataSources, addDataSource } from "./model/dataSourceRegistry"
import { Editor } from "grapesjs"

export default (editor: Editor) => {
  // Save and load data sources
  editor.on('storage:start:store', (data: any) => {
    data.dataSources = getAllDataSources()
      .filter((ds: IDataSource) => typeof ds.readonly === 'undefined' || ds.readonly === false)
      .map((ds: IDataSource) => ({
        id: ds.id,
        label: ds.label,
        url: ds.url,
        type: ds.type,
        method: ds.method,
        headers: ds.headers,
        readonly: ds.readonly,
        hidden: ds.hidden
      }))
  })

  editor.on('storage:end:load', async (data: { dataSources: GraphQLOptions[] }) => {
    // Connect the data sources
    const newDataSources: IDataSource[] = (data.dataSources || [] as GraphQLOptions[])
      .map((ds: GraphQLOptions) => new GraphQL(ds))

    await Promise.all(newDataSources.map((ds: IDataSource) => ds.connect()))

    // Get all data sources
    const dataSources = getAllDataSources()
      // Keep only data sources from the config
      .filter((ds: IDataSource) => ds.readonly === true)

    // Reset the data sources to the original config
    resetDataSources(dataSources)

    // Add the new data sources
    await Promise.all(newDataSources.map(ds => {
      addDataSource(ds)
      return ds.connect()
    }))
    refreshDataSources()
  })
}
