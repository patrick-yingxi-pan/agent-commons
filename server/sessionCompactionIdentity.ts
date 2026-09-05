/** Durable public receipt identity for one logical conversation compaction.
 * Tenant and Session containment participate so the retained browser key never
 * crosses an account or conversation boundary, while the raw key stays private. */
import { createHash } from 'node:crypto'

const SESSION_COMPACTION_ID = /^session-compaction-[a-f0-9]{24}$/

export function sessionCompactionId(
  tenantId: string,
  sessionId: string,
  idempotencyKey: string,
): string {
  const digest = createHash('sha256')
    .update(`${tenantId}\0${sessionId}\0${idempotencyKey}`)
    .digest('hex')
    .slice(0, 24)
  return `session-compaction-${digest}`
}

export const isSessionCompactionId = (id: string): boolean =>
  SESSION_COMPACTION_ID.test(id)
