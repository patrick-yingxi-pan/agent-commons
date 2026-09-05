import { createHash } from 'node:crypto'

const ORG_CREATION_ID = /^tenant-org-new-[a-f0-9]{24}$/

/** Durable identity for one logical organization founding. The founder's home
 * tenant scopes the digest so a reused transport key cannot alias another
 * account's namespace. */
export function orgCreationId(tenantId: string, idempotencyKey: string): string {
  const digest = createHash('sha256')
    .update(`${tenantId}\0${idempotencyKey}`)
    .digest('hex')
    .slice(0, 24)
  return `tenant-org-new-${digest}`
}

export const isOrgCreationId = (id: string): boolean => ORG_CREATION_ID.test(id)
