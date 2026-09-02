import { createHash } from 'node:crypto'

/** Durable identity for one tenant-authored social post. The public id exposes
 * neither the tenant nor the retained transport key, while surviving loss of
 * the in-memory idempotency response cache. */
export function discussionPostId(tenantId: string, idempotencyKey: string): string {
  const digest = createHash('sha256')
    .update(`${tenantId}\0${idempotencyKey}`)
    .digest('hex')
    .slice(0, 24)
  return `dpost-new-${digest}`
}
