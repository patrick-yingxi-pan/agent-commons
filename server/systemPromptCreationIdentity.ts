/** Durable identity for one logical system-prompt creation. The tenant is part
 * of the digest so a retry key cannot alias a prompt across account scopes. */
import { createHash } from 'node:crypto'

export function systemPromptCreationId(tenantId: string, idempotencyKey: string): string {
  const digest = createHash('sha256')
    .update(`${tenantId}\0${idempotencyKey}`)
    .digest('hex')
    .slice(0, 24)
  return `sp-new-${digest}`
}
