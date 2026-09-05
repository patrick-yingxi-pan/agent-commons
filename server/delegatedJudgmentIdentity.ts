/** Durable public receipt identity for one logical delegated judgment.
 * Tenant, containment, and immutable Delegation all participate so one retry
 * key cannot alias another authority exercise. */
import { createHash } from 'node:crypto'

const DELEGATED_JUDGMENT_ID = /^delegated-judgment-[a-f0-9]{24}$/

export function delegatedJudgmentId(
  tenantId: string,
  projectId: string,
  contributionId: string,
  delegationId: string,
  idempotencyKey: string,
): string {
  const digest = createHash('sha256')
    .update(`${tenantId}\0${projectId}\0${contributionId}\0${delegationId}\0${idempotencyKey}`)
    .digest('hex')
    .slice(0, 24)
  return `delegated-judgment-${digest}`
}

export const isDelegatedJudgmentId = (id: string): boolean =>
  DELEGATED_JUDGMENT_ID.test(id)
