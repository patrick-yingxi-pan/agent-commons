/** Durable public receipt identity for one logical Contribution review.
 * Tenant and containment participate so one retry key cannot alias another
 * account or ledger row; the reviewed version is proved by the event. */
import { createHash } from 'node:crypto'

const CONTRIBUTION_REVIEW_ID = /^contribution-review-[a-f0-9]{24}$/

export function contributionReviewId(
  tenantId: string,
  projectId: string,
  contributionId: string,
  idempotencyKey: string,
): string {
  const digest = createHash('sha256')
    .update(`${tenantId}\0${projectId}\0${contributionId}\0${idempotencyKey}`)
    .digest('hex')
    .slice(0, 24)
  return `contribution-review-${digest}`
}

export const isContributionReviewId = (id: string): boolean =>
  CONTRIBUTION_REVIEW_ID.test(id)
