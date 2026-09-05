/** Durable identity for one logical Delegation creation. Project and tenant
 * both participate so a retry key cannot alias authority across either wall. */
import { createHash } from 'node:crypto'

const DELEGATION_CREATION_ID = /^delegation-new-[a-f0-9]{24}$/

export function delegationCreationId(
  tenantId: string,
  projectId: string,
  idempotencyKey: string,
): string {
  const digest = createHash('sha256')
    .update(`${tenantId}\0${projectId}\0${idempotencyKey}`)
    .digest('hex')
    .slice(0, 24)
  return `delegation-new-${digest}`
}

export const isDelegationCreationId = (id: string): boolean =>
  DELEGATION_CREATION_ID.test(id)
