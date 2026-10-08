import { store } from './store/index.ts'

/** The current, tenant-scoped model context for a conversation turn.
 *
 * Keep this as a live projection: model turns must resolve names against the
 * registries the caller can currently see, while write targets remain limited
 * to resources the caller owns. */
export function conversationContext(sessionId: string, tenantId: string) {
  const createdProjectIds = new Set(store.relationGraph(tenantId).extraProjects.map((project) => project.id))
  const commons = {
    // `isDefault` supports the same default-else-first selection as the UI.
    providers: store.listProviders(tenantId).map((provider) => ({
      id: provider.id,
      label: provider.label,
      isDefault: provider.isDefault,
    })),
    systemPrompts: store.listSystemPrompts(tenantId).map((prompt) => ({
      id: prompt.id,
      label: prompt.label,
      isDefault: prompt.isDefault,
    })),
    agents: store.listAgents(tenantId).map((agent) => ({ id: agent.id, label: agent.label })),
    commissions: store.listCommissions(undefined, tenantId).map((commission) => ({
      id: commission.id,
      agentId: commission.agentId,
      projectId: commission.projectId,
    })),
    projects: store.listProjects(tenantId).map((project) => ({
      id: project.id,
      name: project.name,
      defaultRole: project.defaultRole,
      description: project.description,
      instructions: project.instructions,
      own: project.own,
      shared: project.shared,
      shareable: createdProjectIds.has(project.id),
    })),
    // Read grants do not make an Artifact a model-proposed write target.
    artifacts: store.listArtifacts(tenantId)
      .filter((artifact) => artifact.own === true)
      .map((artifact) => ({ id: artifact.id, name: artifact.name })),
    schedules: store.listSchedules(tenantId).map((schedule) => ({
      id: schedule.id,
      name: schedule.name,
      cadence: schedule.cadence,
    })),
    // Saved connectors/MCP servers overlay the shared catalog by identity.
    connectors: (() => {
      const byId = new Map(store.contextCatalog().connectors.map((connector) => [
        connector.id,
        { id: connector.id, label: connector.label, kind: connector.kind },
      ]))
      for (const context of store.savedContexts(tenantId).contexts) {
        if (context.kind === 'connector' || context.kind === 'mcp') {
          byId.set(context.id, { id: context.id, label: context.label, kind: context.connectorKind })
        }
      }
      return [...byId.values()]
    })(),
  }

  return {
    commons,
    contexts: store.sessionContexts(sessionId),
    externalMcpConnections: store.mcpConnections(tenantId),
  }
}
