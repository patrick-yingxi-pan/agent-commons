/** Durable identity for one logical Delegation revocation. The acting tenant,
 * Project, and exact authority row all participate so one retry key cannot
 * replay across an authorization or containment wall. */
import { createHash } from 'node:crypto'

const DELEGATION_REVOCATION_ID = /^delegation-revoke-[a-f0-9]{24}$/

export function delegationRevocationId(
  tenantId: string,
  projectId: string,
  delegationId: string,
  idempotencyKey: string,
): string {
  const digest = createHash('sha256')
    .update(`${tenantId}\0${projectId}\0${delegationId}\0${idempotencyKey}`)
    .digest('hex')
    .slice(0, 24)
  return `delegation-revoke-${digest}`
}

export const isDelegationRevocationId = (id: string): boolean =>
  DELEGATION_REVOCATION_ID.test(id)
