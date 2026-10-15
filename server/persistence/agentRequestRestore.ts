/** Explicit rollback is not an ordinary restart. Even unattempted requests in
 * the backup might have run in the discarded future; require a fresh request. */
import type { PersistedState } from './format.ts'
import { parseProxyRequests } from '../proxyRequestRegistry.ts'
import { interruptProxyRequest, parseStoredProxyRequest } from '../proxyRequestState.ts'
import { proxyArgumentReservationId } from '../proxyArgumentDraftState.ts'

export function prepareAgentRequestRestoreState(state: PersistedState, now = Date.now()): PersistedState {
  if (!Number.isSafeInteger(now) || now < 0) throw new Error('Invalid Agent request restore timestamp.')
  if (state.agentRequests === undefined) return state
  const rows = parseProxyRequests(state.agentRequests)
  const pendingDraftIds = new Set(rows.filter(row => row.argumentDraft?.status === 'pending')
    .map(row => proxyArgumentReservationId(row.intent.id)))
  state.agentRequests = rows.map(row => {
    const interrupted = interruptProxyRequest(row, Math.max(now, row.updatedAt))
    return row.status === 'waiting'
      ? parseStoredProxyRequest({ ...interrupted, executionBlockedByRestore: true })
      : interrupted
  })
  // Restore is a hard interruption boundary, not ordinary process recovery.
  // Any still-active draft reservation is retained as uncertain alongside its
  // interrupted private receipt; known usage is never rewritten.
  if (state.usageReservations !== undefined) {
    state.usageReservations = state.usageReservations.map(reservation =>
      pendingDraftIds.has(reservation.id) && reservation.status === 'active'
        ? { ...reservation, status: 'uncertain' }
        : reservation)
  }
  return state
}
