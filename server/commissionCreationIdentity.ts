/** Durable identity for one logical Contributor commission. The tenant is part
 * of the digest so a retry key cannot alias an assignment across accounts. */
import { createHash } from 'node:crypto'

export function commissionCreationId(tenantId: string, idempotencyKey: string): string {
  const digest = createHash('sha256')
    .update(`${tenantId}\0${idempotencyKey}`)
    .digest('hex')
    .slice(0, 24)
  return `commission-new-${digest}`
}
