/** Exercise the real Routine MCP owner and durable run seams in a comprehensive
 * snapshot. The executor is a deterministic local fixture: it never opens an
 * external connection, but store admission/reservation/settlement stay canonical. */
import type { McpBoundToolCall } from '../contract/mcpExecution.ts'
import type { RoutineMcpApprovalIntent } from '../contract/routineMcp.ts'
import type { store as Store } from '../server/store/index.ts'
import { DEFAULT_PROVIDER } from '../server/data/providers.ts'
import { mcpConnectionCreationId } from '../server/mcpConnections.ts'
import { admitMcpCatalog, mcpToolSchemaHash } from '../server/mcpToolAdmission.ts'
import { DEFAULT_AGENT } from '../server/data/workers.ts'

export async function addRoutineMcpSnapshotFixture(store: typeof Store, routineId: string): Promise<void> {
  const template = store.listSchedules().find((candidate) => candidate.id === routineId)
  if (!template) throw new Error('Routine MCP snapshot fixture requires its created Routine')
  const tenantId = 'tenant-zeta'
  const { id: _templateId, tenantId: _templateTenant, ...seed } = structuredClone(template)
  // Keep the MCP persistence fixture independent from the comprehensive routine's
  // legacy connector/context and standing-artifact setup. It still runs through
  // the real store binding and authorization path under an explicit live model.
  const routine = store.addSchedule({
    ...seed,
    tenantId,
    name: 'Offline Routine MCP snapshot fixture',
    enabled: false,
    runs: [],
    steps: [],
    agentId: DEFAULT_AGENT.id,
    providerId: DEFAULT_PROVIDER.id,
    modelId: 'claude-opus-4-8',
    model: 'Claude Opus 4.8',
    delivery: { tool: { id: 'assistant', label: 'Assistant', tone: 'claude' }, target: 'Run conversation' },
  }, 'routine-mcp-snapshot-fixture')
  const connectionId = mcpConnectionCreationId(tenantId, 'snapshot-active')
  const existing = store.mcpConnection(connectionId, tenantId)
  if (!existing || existing.status !== 'connected') throw new Error('Routine MCP snapshot fixture requires the comprehensive catalog connection')
  const tool = { name: 'snapshot_fixture', inputSchema: { type: 'object', properties: {}, additionalProperties: true } }
  const schemaAdmission = await admitMcpCatalog([tool])
  const connection = store.commitMcpInspection(connectionId, tenantId, existing.revision, {
    protocolVersion: '2026-07-28', cleanup: 'not-needed', tools: [tool], schemaAdmission,
  }, Date.now())
  const review = store.routineMcpReview(routine.id, tenantId)
  const selected = review?.tools.find((candidate) => candidate.connectionId === connection.id && candidate.tool.name === tool.name)
  if (!review || !selected) throw new Error('Routine MCP snapshot fixture tool is outside the Routine owner authority')
  const approval: RoutineMcpApprovalIntent = {
    expectedRevision: review.policy.revision,
    expectedDefinitionRevision: review.definitionRevision,
    reviewHash: review.reviewHash,
    expiresAt: Date.now() + 60 * 60 * 1000,
    maxCallsPerRun: 1,
    tools: [{ connectionId, connectionRevision: connection.revision, toolName: selected.tool.name,
      schemaHash: selected.schemaHash, fixedArguments: {} }],
  }
  const decision = store.decideRoutineMcp(routine.id, tenantId, {
    requestId: 'snapshot-routine-mcp-approval', action: 'approve', approval,
  })
  if (!decision) throw new Error('Routine MCP snapshot fixture owner decision was not admitted')
  const run = store.runSchedule(routine.id, { manualRunId: 'run-routine-mcp-snapshot' })
  if (!run || run.id !== 'run-routine-mcp-snapshot' || run.status !== 'running') {
    throw new Error('Routine MCP snapshot fixture could not queue an execution-aware run')
  }
  const call: McpBoundToolCall = { connectionId, connectionRevision: connection.revision,
    toolName: selected.tool.name, schemaHash: selected.schemaHash, arguments: {} }
  const receipt = await store.executeRoutineMcpCall(routine.id, run.id, call, 'snapshot-routine-mcp-call', undefined,
    async (_host, _owner, _call, stillAuthorized) => {
      if (!stillAuthorized()) return { status: 'failed', summary: 'Fixture authority changed.' }
      return { status: 'done', summary: 'Offline deterministic Routine MCP fixture.',
        result: { resultType: 'complete', content: [{ type: 'text', text: 'Offline snapshot fixture result.' }], isError: false } }
    })
  if (receipt.status !== 'done') throw new Error(`Routine MCP snapshot fixture call did not settle as a known result (${receipt.status})`)
  store.failScheduleRun(routine.id, run.id, 'execution_error', 'Offline snapshot fixture run is terminal.')
}
