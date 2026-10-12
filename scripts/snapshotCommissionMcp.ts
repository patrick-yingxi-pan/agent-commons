/** Add one inert, fully joined Commission MCP history to a portable snapshot.
 * This is an offline persisted fixture, not a simulated live consent workflow:
 * it uses local registry transitions and never opens an MCP transport. */
import type { PersistedState } from '../server/persistence/persist.ts'
import { CommissionMcpRegistry } from '../server/commissionMcpRegistry.ts'
import { createMcpConnectionRegistry, mcpConnectionCreationId } from '../server/mcpConnections.ts'
import { MCP_SCHEMA_ADMISSION_VERSION, mcpToolSchemaHash } from '../server/mcpToolAdmission.ts'
import { DEFAULT_AGENT } from '../server/data/workers.ts'

const TENANT = 'tenant-zeta'
const OWNER = 'user-zeta'
const AGENT_ID = 'agent-commission-mcp-snapshot'
const COMMISSION_ID = 'commission-mcp-snapshot'
const ITEM_ID = 'work-commission-mcp-snapshot'
const NOW = Date.parse('2026-10-04T12:00:00.000Z')
const REVIEW_HASH = 'c'.repeat(64)

/** Pure in-memory fixture construction over an existing canonical snapshot.
 * It reuses the comprehensive tenant-zeta catalog when available and otherwise
 * creates the same inspected local-only template in memory. */
export function addCommissionMcpSnapshotFixture(
  input: PersistedState, phase: 'done' | 'preparing' | 'effect-pending' = 'done', projectOverride?: string,
): PersistedState {
  const state = structuredClone(input)
  const projectId = projectOverride ?? (state.graph.extraProjects?.some(project => project.id === 'p-playground') ? 'p-playground' : 'p-insights')
  if (!state.agents || !state.commissions || !state.openSubGoals) {
    throw new Error('Commission MCP snapshot fixture requires canonical Agent, Commission, and open-work slices')
  }

  const template = state.agents.find(([id]) => id === DEFAULT_AGENT.id)?.[1]
  if (!template) throw new Error('Commission MCP snapshot fixture requires the canonical default Agent')
  const agent = { ...structuredClone(template), id: AGENT_ID, tenantId: TENANT,
    label: 'Offline Commission MCP snapshot Agent', contributions: 0, forks: 0 }
  state.agents.push([agent.id, agent])

  const commission = { id: COMMISSION_ID, tenantId: TENANT, agentId: agent.id,
    projectId, role: 'maintainer' as const, configurationRevision: 0, standing: true }
  state.commissions.push([commission.id, commission])

  const connectionRegistry = createMcpConnectionRegistry()
  connectionRegistry.rehydrate(state.mcpConnections ?? { connections: [], retired: [] })
  const reusable = connectionRegistry.snapshot().connections.find(row => row.tenantId === TENANT && row.connected &&
    row.transport !== 'stdio' && row.inspection?.tools.some(candidate => candidate.name === 'snapshot_fixture') &&
    row.inspection.schemaAdmission?.hashes.includes(mcpToolSchemaHash(row.inspection.tools.find(candidate => candidate.name === 'snapshot_fixture')!)))
  const connectionId = mcpConnectionCreationId(TENANT, 'commission-mcp-snapshot')
  let tool = reusable ? connectionRegistry.privateConnection(reusable.id, TENANT) : connectionRegistry.privateConnection(connectionId, TENANT)
  if (!tool) {
    const discovered = { name: 'snapshot_fixture', inputSchema: { type: 'object', properties: {}, additionalProperties: true } }
    const schemaHash = mcpToolSchemaHash(discovered)
    connectionRegistry.create({ id: connectionId, label: 'Offline Commission MCP fixture',
      endpoint: 'https://mcp.example/commission-snapshot', authentication: 'none' }, TENANT)
    connectionRegistry.commitInspection(connectionId, TENANT, 0, { protocolVersion: '2026-07-28', cleanup: 'not-needed',
      tools: [discovered], schemaAdmission: { version: MCP_SCHEMA_ADMISSION_VERSION, hashes: [schemaHash] } }, NOW)
    tool = connectionRegistry.privateConnection(connectionId, TENANT)
  }
  state.mcpConnections = connectionRegistry.snapshot()
  const discoveredTool = tool?.inspection?.tools.find(candidate => candidate.name === 'snapshot_fixture')
  const hasAdmission = discoveredTool && tool?.inspection?.schemaAdmission?.hashes.includes(mcpToolSchemaHash(discoveredTool))
  if (!tool || !discoveredTool || !hasAdmission || tool.transport === 'stdio' || tool.authentication !== 'none') {
    throw new Error('Commission MCP snapshot fixture requires an inspected tenant-zeta HTTP tool')
  }
  const discovered = tool.inspection!.tools.find(candidate => candidate.name === 'snapshot_fixture')!
  const contexts = state.graph.projectContexts[projectId] ?? (state.graph.projectContexts[projectId] = [])
  if (!contexts.some(context => context.kind === 'connector' && context.label === discovered.name)) {
    contexts.push({ kind: 'connector', label: discovered.name, meta: 'Offline snapshot fixture' })
  }
  const work = { id: ITEM_ID, projectId, subGoal: 'offline snapshot MCP work',
    type: 'mcp.mutate' as const, target: discovered.name, note: 'Persist a known local receipt.',
    postedBy: 'Zeta Workspace', postedByTenant: TENANT, postedAt: NOW, status: 'open' as const }
  state.openSubGoals.push(work)

  const schemaHash = mcpToolSchemaHash(discovered)
  const permission = { connectionId: tool.id, connectionRevision: tool.revision,
    toolName: discovered.name, schemaHash, fixedArguments: {} }
  const registry = new CommissionMcpRegistry(state.commissionMcp)
  const liveReview = { configurationRevision: commission.configurationRevision, reviewHash: REVIEW_HASH }
  const context = { configurationRevision: commission.configurationRevision, reviewHash: REVIEW_HASH,
    now: NOW, connection: (id: string, tenantId: string, ownerUserId: string) =>
      tenantId === TENANT && ownerUserId === OWNER ? connectionRegistry.view(id, tenantId) : undefined }
  const approved = registry.approve({ tenantId: TENANT, ownerUserId: OWNER, projectId,
    commissionId: COMMISSION_ID, agentId: AGENT_ID }, {
    expectedRevision: 0, expectedConfigurationRevision: commission.configurationRevision,
    reviewHash: REVIEW_HASH, execution: { agentId: AGENT_ID, providerId: agent.providerId ?? 'provider-anthropic',
      modelId: 'claude-opus-4-8' }, expiresAt: NOW + 60 * 60 * 1000, maxWorkItems: 1, tools: [permission],
  }, context)
  const frozenWork = { itemId: work.id, subGoal: work.subGoal, type: work.type, target: work.target, note: work.note }
  registry.reserve({ permission: approved, work: frozenWork, tool: permission, review: liveReview,
    now: NOW + 1, connection: context.connection })
  if (phase !== 'preparing') {
    registry.beginEffect(projectId, ITEM_ID, { connectionId: tool.id, connectionRevision: tool.revision,
      toolName: discovered.name, schemaHash, arguments: {} }, { ...liveReview, now: NOW + 2, connection: context.connection })
    if (phase === 'done') registry.settleEffect(projectId, ITEM_ID, { status: 'done', summary: 'Offline Commission MCP snapshot receipt.',
      result: { resultType: 'complete', content: [{ type: 'text', text: 'Known offline fixture result.' }], isError: false } }, NOW + 3)
  }
  state.commissionMcp = registry.snapshot()
  // This fixture never runs a model. Current-version claim snapshots still need
  // an exact usage-receipt join, so represent that known zero usage explicitly.
  const claim = state.commissionMcp.claims.find(row => row.permission.commissionId === COMMISSION_ID)!
  state.usageReservations ??= []
  state.usageReservations.push({ id: claim.id, tenantId: TENANT, allowance: 1,
    fiveHourStart: 0, weeklyStart: 0, status: 'settled', report: { inputTokens: 0, outputTokens: 0 } })
  return state
}

/** Attach a private reservation to the Commission-only fixture. This constructs
 * persisted bytes directly for restart and admission tests; it never invokes a
 * model or changes the live usage meter. */
export function addCommissionUsageReservationSnapshotFixture(
  input: PersistedState,
  status: 'active' | 'uncertain' | 'settled' = 'active',
): PersistedState {
  const state = addCommissionMcpSnapshotFixture(input, status === 'active' ? 'preparing' : 'done')
  const claim = state.commissionMcp!.claims.find(row => row.permission.commissionId === COMMISSION_ID)!
  state.usageReservations = [{ id: claim.id, tenantId: TENANT, allowance: 10_000,
    fiveHourStart: 1_791_120_000_000, weeklyStart: 1_791_120_000_000,
    status, report: status === 'settled' ? { inputTokens: 23, outputTokens: 9 } : null }]
  return state
}
