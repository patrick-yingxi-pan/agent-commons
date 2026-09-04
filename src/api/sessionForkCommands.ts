/** Lazy transport and exact-identity reconciliation for conversation branches. */
import type { ForkSessionRequest, Session } from '../../contract/index.ts'
import { ApiRequestError, apiPost } from './client.ts'
import { loadSession } from './commands.ts'
import { invalidate, setData } from './cache.ts'
import { keys, paths } from './keys.ts'
import { sessionForkCreationId } from './sessionCreationIdentity.ts'

export interface SessionForkIntent {
  intentId: string
  tenantId: string
  sourceSessionId: string
  atMessageId: string
}

export async function applySessionFork(
  intent: SessionForkIntent,
  idempotencyKey: string,
): Promise<void> {
  const session = await apiPost<Session>(
    paths.sessionFork(intent.sourceSessionId),
    { atMessageId: intent.atMessageId } satisfies ForkSessionRequest,
    { idempotencyKey },
  )
  setData(keys.session(session.id), session)
  invalidate(keys.sessions)
}

export async function reconcileSessionFork(
  intent: SessionForkIntent,
  _baseline: undefined,
  idempotencyKey: string,
): Promise<boolean> {
  const expectedId = await sessionForkCreationId(intent.tenantId, idempotencyKey)
  try {
    const session = await loadSession(expectedId)
    return session.forkedFrom?.sessionId === intent.sourceSessionId &&
      session.forkedFrom.atMessageId === intent.atMessageId
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) return false
    throw error
  }
}
