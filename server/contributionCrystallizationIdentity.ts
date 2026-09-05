/** Durable public receipt identity for one logical Contribution crystallization.
 * Tenant and containment participate so a retry key cannot alias another
 * account or ledger row. The payload does not: changed Retry input must meet
 * the original receipt and be rejected instead of appending another version. */
import { createHash } from 'node:crypto'

const CONTRIBUTION_CRYSTALLIZATION_ID = /^contribution-crystallization-[a-f0-9]{24}$/

export function contributionCrystallizationId(
  tenantId: string,
  projectId: string,
  contributionId: string,
  idempotencyKey: string,
): string {
  const digest = createHash('sha256')
    .update(`${tenantId}\0${projectId}\0${contributionId}\0${idempotencyKey}`)
    .digest('hex')
    .slice(0, 24)
  return `contribution-crystallization-${digest}`
}

export const isContributionCrystallizationId = (id: string): boolean =>
  CONTRIBUTION_CRYSTALLIZATION_ID.test(id)
