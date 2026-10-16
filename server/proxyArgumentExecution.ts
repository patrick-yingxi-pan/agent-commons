/** MCP argument advice supplies its strict grammar to the shared private draft
 * worker. It has no MCP execution door; human Run is a separate operation. */
import type { AgentRequestArgumentDraftBinding } from '../contract/agentRequests.ts'
import type { McpDiscoveredTool } from '../contract/mcpConnections.ts'
import { ProxyArgumentPreparationOutputError, type PreparedProxyArgumentInput, type ProxyArgumentDraft } from './proxyArgumentPreparation.ts'
import { beginProxyArgumentDraft, settleProxyArgumentDraft } from './proxyRequestState.ts'
import { proxyArgumentReservationId } from './proxyArgumentDraftState.ts'
import { snapshotMcpJson } from './mcpJson.ts'
import { validateMcpSchema } from './mcpSchema.ts'
import { mcpToolSchemaHash } from './mcpToolAdmission.ts'
import { ProxyModelDraftExecution, type ProxyModelDraftPort, type ProxyModelDraftSource } from './proxyModelDraftExecution.ts'

export interface ProxyArgumentSource extends ProxyModelDraftSource<PreparedProxyArgumentInput> {
  tool: McpDiscoveredTool
}
export type ProxyArgumentExecutionPort = ProxyModelDraftPort<AgentRequestArgumentDraftBinding, PreparedProxyArgumentInput,
  ProxyArgumentDraft, undefined, ProxyArgumentSource>

export class ProxyArgumentExecution extends ProxyModelDraftExecution<AgentRequestArgumentDraftBinding, PreparedProxyArgumentInput,
  ProxyArgumentDraft, undefined, ProxyArgumentSource> {
  constructor(port: ProxyArgumentExecutionPort, timeoutMs = 60_000) {
    super(port, {
      parse(value) {
        const copy = snapshotMcpJson(value, { maxBytes: 4_096, maxDepth: 3, maxNodes: 32 })
        if (!copy || typeof copy !== 'object' || Array.isArray(copy) || Object.keys(copy).length !== 3 ||
            Object.keys(copy).some(key => !['action', 'expectedRevision', 'binding'].includes(key)) || copy.action !== 'draft-arguments' ||
            !Number.isSafeInteger(copy.expectedRevision)) throw new Error('Invalid argument draft input.')
        return { expectedRevision: copy.expectedRevision as number, binding: copy.binding as unknown as AgentRequestArgumentDraftBinding, notes: undefined }
      },
      eligible: row => row.status === 'waiting' && !row.argumentDraft && !row.executionBlockedByRestore && row.replyDraft?.status !== 'pending',
      live: row => row.status === 'waiting',
      receipt: row => row.argumentDraft,
      begin: beginProxyArgumentDraft,
      settle: (row, hash, outcome, at) => settleProxyArgumentDraft(row, hash,
        outcome.status === 'done' ? { status: 'done', arguments: outcome.value.arguments } : outcome, at),
      validSource: (source, binding) => source.prepared.toolName === binding.toolName && source.tool.name === binding.toolName &&
        mcpToolSchemaHash(source.tool) === binding.schemaHash,
      validResult: async (source, binding, result, signal) => result.toolName === binding.toolName &&
        (await validateMcpSchema(source.tool.inputSchema, { value: result.arguments }, { signal })).ok,
      outputError: error => error instanceof ProxyArgumentPreparationOutputError,
      reservationId: proxyArgumentReservationId,
    }, timeoutMs)
  }
}
