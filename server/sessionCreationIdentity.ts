import { createHash } from 'node:crypto'

const DRAFT_SESSION_CREATION_ID = /^sess-new-[a-f0-9]{24}$/
const FORK_SESSION_CREATION_ID = /^sess-fork-[a-f0-9]{24}$/

function opaqueId(prefix: 'new' | 'fork', tenantId: string, idempotencyKey: string): string {
  const digest = createHash('sha256')
    .update(`${tenantId}\0${idempotencyKey}`)
    .digest('hex')
    .slice(0, 24)
  return `sess-${prefix}-${digest}`
}

/** One logical draft materialization has one opaque, tenant-scoped row id. */
export function sessionCreationId(tenantId: string, idempotencyKey: string): string {
  return opaqueId('new', tenantId, idempotencyKey)
}

/** One logical Continue-from-here act has a disjoint opaque Session identity,
 * so even a reused transport key cannot alias an ordinary draft creation. */
export function sessionForkCreationId(tenantId: string, idempotencyKey: string): string {
  return opaqueId('fork', tenantId, idempotencyKey)
}

export const isDraftSessionCreationId = (id: string): boolean => DRAFT_SESSION_CREATION_ID.test(id)
export const isForkSessionCreationId = (id: string): boolean => FORK_SESSION_CREATION_ID.test(id)
export const isSessionCreationId = (id: string): boolean =>
  isDraftSessionCreationId(id) || isForkSessionCreationId(id)
