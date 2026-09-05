/** Transport and exact-receipt reconciliation for model-backed compaction. */
import type { Session } from '../../contract/index.ts'
import { apiGet, apiPost } from './client.ts'
import { invalidate, invalidatePrefix } from './cache.ts'
import { keys, paths } from './keys.ts'
import { MESSAGE_PAGE_SIZE } from './sessionPaging.ts'
import { sessionCompactionId } from './sessionCompactionIdentity.ts'

export interface SessionCompactionIntent {
  readonly intentId: string
  readonly tenantId: string
  readonly sessionId: string
}

const hasReceipt = (session: Session, expectedId: string): boolean =>
  session.compactionReceiptIds?.includes(expectedId) === true

const rememberCompaction = (sessionId: string): void => {
  invalidate(keys.session(sessionId))
  invalidate(keys.usage(sessionId))
  invalidatePrefix(keys.sessionCompactedMessages(sessionId))
}

export async function applySessionCompaction(
  intent: SessionCompactionIntent,
  idempotencyKey: string,
): Promise<Session> {
  const expectedId = await sessionCompactionId(intent.tenantId, intent.sessionId, idempotencyKey)
  const session = await apiPost<Session>(paths.sessionCompact(intent.sessionId), {}, { idempotencyKey })
  if (!hasReceipt(session, expectedId)) {
    throw new Error('The compaction acknowledgement did not match this exact conversation request.')
  }
  rememberCompaction(intent.sessionId)
  return session
}

export async function reconcileSessionCompaction(
  intent: SessionCompactionIntent,
  idempotencyKey: string,
): Promise<Session | undefined> {
  const expectedId = await sessionCompactionId(intent.tenantId, intent.sessionId, idempotencyKey)
  const session = await apiGet<Session>(paths.session(intent.sessionId, { limit: MESSAGE_PAGE_SIZE }))
  if (!hasReceipt(session, expectedId)) return undefined
  rememberCompaction(intent.sessionId)
  return session
}
