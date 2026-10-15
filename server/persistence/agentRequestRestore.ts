/** Explicit rollback is not an ordinary restart. Even unattempted requests in
 * the backup might have run in the discarded future; require a fresh request. */
import type { PersistedState } from './format.ts'
import { parseProxyRequests } from '../proxyRequestRegistry.ts'
import { interruptProxyRequest, parseStoredProxyRequest } from '../proxyRequestState.ts'

export function prepareAgentRequestRestoreState(state: PersistedState, now = Date.now()): PersistedState {
  if (!Number.isSafeInteger(now) || now < 0) throw new Error('Invalid Agent request restore timestamp.')
  if (state.agentRequests === undefined) return state
  state.agentRequests = parseProxyRequests(state.agentRequests).map(row => row.status === 'waiting'
    ? parseStoredProxyRequest({ ...row, executionBlockedByRestore: true })
    : interruptProxyRequest(row, Math.max(now, row.updatedAt)))
  return state
}
