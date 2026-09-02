/** Durable identity for one logical provider registration. The tenant is part
 * of the digest so retry keys can never alias a row across account scopes. */
import { createHash } from 'node:crypto'

export function providerCreationId(tenantId: string, idempotencyKey: string): string {
  const digest = createHash('sha256')
    .update(`${tenantId}\0${idempotencyKey}`)
    .digest('hex')
    .slice(0, 24)
  return `provider-new-${digest}`
}
