/** Durable public receipt identity for one logical Contribution review
 * requirement. Tenant and containment participate so one retry key cannot
 * alias another account or ledger row; the event kind proves the monotonic
 * tightening act without exposing the raw authority anchor. */
import { createHash } from 'node:crypto'

const CONTRIBUTION_REVIEW_REQUIREMENT_ID = /^contribution-require-review-[a-f0-9]{24}$/

export function contributionReviewRequirementId(
  tenantId: string,
  projectId: string,
  contributionId: string,
  idempotencyKey: string,
): string {
  const digest = createHash('sha256')
    .update(`${tenantId}\0${projectId}\0${contributionId}\0${idempotencyKey}`)
    .digest('hex')
    .slice(0, 24)
  return `contribution-require-review-${digest}`
}

export const isContributionReviewRequirementId = (id: string): boolean =>
  CONTRIBUTION_REVIEW_REQUIREMENT_ID.test(id)
