import { createHash } from 'node:crypto'

const SESSION_CREATION_ID = /^sess-new-[a-f0-9]{24}$/

/** One logical draft materialization has one opaque, tenant-scoped row id. */
export function sessionCreationId(tenantId: string, idempotencyKey: string): string {
  const digest = createHash('sha256')
    .update(`${tenantId}\0${idempotencyKey}`)
    .digest('hex')
    .slice(0, 24)
  return `sess-new-${digest}`
}

export const isSessionCreationId = (id: string): boolean => SESSION_CREATION_ID.test(id)
