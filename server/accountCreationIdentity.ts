import { createHash } from 'node:crypto'

const USER_CREATION_ID = /^user-new-[a-f0-9]{24}$/
const TENANT_CREATION_ID = /^tenant-user-new-[a-f0-9]{24}$/

/** One first-party signup retry owns one opaque user + namespace pair. The
 * browser's expected source scopes the key so the same logical token cannot
 * alias an account created from another signed-in world. */
export function accountCreationIds(
  source: string,
  idempotencyKey: string,
): { userId: string; tenantId: string } {
  const digest = createHash('sha256')
    .update(`${source}\0${idempotencyKey}`)
    .digest('hex')
    .slice(0, 24)
  return {
    userId: `user-new-${digest}`,
    tenantId: `tenant-user-new-${digest}`,
  }
}

export const isAccountCreationUserId = (id: string): boolean => USER_CREATION_ID.test(id)
export const isAccountCreationTenantId = (id: string): boolean => TENANT_CREATION_ID.test(id)
