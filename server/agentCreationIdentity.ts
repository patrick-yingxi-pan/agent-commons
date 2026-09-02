/** Durable identity for one logical Agent creation. The tenant is part of the
 * digest so a retry key can never alias an Agent across account scopes. */
import { createHash } from 'node:crypto'

export function agentCreationId(tenantId: string, idempotencyKey: string): string {
  const digest = createHash('sha256')
    .update(`${tenantId}\0${idempotencyKey}`)
    .digest('hex')
    .slice(0, 24)
  return `agent-new-${digest}`
}
