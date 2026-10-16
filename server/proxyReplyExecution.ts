/** Tool-free reply drafting supplies its own strict prose grammar to the shared
 * private draft worker. Suggestions remain private until the owner explicitly
 * adopts, reviews and shares them. */
import type { AgentRequestReplyDraftBinding } from '../contract/agentRequests.ts'
import { AGENT_REQUEST_REPLY_NOTES_MAX_BYTES } from '../contract/agentRequests.ts'
import { ProxyReplyPreparationOutputError, parseProxyReplyDraft, validProxyReplyNotes,
  type PreparedProxyReplyInput } from './proxyReplyPreparation.ts'
import { beginProxyReplyDraft, settleProxyReplyDraft } from './proxyRequestState.ts'
import { proxyReplyReservationId } from './proxyReplyDraftState.ts'
import { snapshotMcpJson } from './mcpJson.ts'
import { ProxyModelDraftExecution, type ProxyModelDraftPort, type ProxyModelDraftSource } from './proxyModelDraftExecution.ts'

export type ProxyReplySource = ProxyModelDraftSource<PreparedProxyReplyInput>
export type ProxyReplyExecutionPort = ProxyModelDraftPort<AgentRequestReplyDraftBinding,
  PreparedProxyReplyInput, string, string, ProxyReplySource>

export class ProxyReplyExecution extends ProxyModelDraftExecution<AgentRequestReplyDraftBinding,
  PreparedProxyReplyInput, string, string, ProxyReplySource> {
  constructor(port: ProxyReplyExecutionPort, timeoutMs = 60_000) {
    super(port, {
      parse(value) {
        const copy = snapshotMcpJson(value, { maxBytes: 2 * AGENT_REQUEST_REPLY_NOTES_MAX_BYTES + 4_096, maxDepth: 4, maxNodes: 48 })
        if (!copy || typeof copy !== 'object' || Array.isArray(copy) || Object.keys(copy).length !== 4 ||
            Object.keys(copy).some(key => !['action', 'expectedRevision', 'binding', 'notes'].includes(key)) ||
            copy.action !== 'draft-reply' || !Number.isSafeInteger(copy.expectedRevision) ||
            !validProxyReplyNotes(copy.notes)) throw new Error('Invalid Agent request reply draft input.')
        return { expectedRevision: copy.expectedRevision as number,
          binding: copy.binding as unknown as AgentRequestReplyDraftBinding, notes: copy.notes }
      },
      eligible: row => ['waiting', 'awaiting-reply'].includes(row.status) && !row.replyDraft &&
        row.argumentDraft?.status !== 'pending' && row.execution?.status !== 'pending' && !row.executionBlockedByRestore,
      live: row => ['waiting', 'awaiting-reply'].includes(row.status),
      receipt: row => row.replyDraft,
      // Notes are input-only; the state transition validates an empty sentinel
      // rather than persisting the request's private prompt material.
      begin: (row, actor, revision, binding, hash, at) =>
        beginProxyReplyDraft(row, actor, revision, binding, hash, '', at),
      settle: (row, hash, outcome, at) => settleProxyReplyDraft(row, hash,
        outcome.status === 'done' ? { status: 'done', text: outcome.value } : outcome, at),
      // The store's source resolver pins Agent, provider, connection and model
      // revisions before returning this source and repeats that check live.
      validSource: () => true,
      validResult: async (_source, _binding, result) => {
        try { return parseProxyReplyDraft(result) === result } catch { return false }
      },
      outputError: error => error instanceof ProxyReplyPreparationOutputError,
      reservationId: proxyReplyReservationId,
    }, timeoutMs)
  }
}
