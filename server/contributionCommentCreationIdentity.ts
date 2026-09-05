/** Durable public receipt identity for one logical Contribution comment.
 * Tenant and containment participate so a retry key cannot alias another
 * account, Project, or ledger row; exact prose remains server-proved. */
import { createHash } from 'node:crypto'

const CONTRIBUTION_COMMENT_CREATION_ID = /^contribution-comment-new-[a-f0-9]{24}$/

export function contributionCommentCreationId(
  tenantId: string,
  projectId: string,
  contributionId: string,
  idempotencyKey: string,
): string {
  const digest = createHash('sha256')
    .update(`${tenantId}\0${projectId}\0${contributionId}\0${idempotencyKey}`)
    .digest('hex')
    .slice(0, 24)
  return `contribution-comment-new-${digest}`
}

export const isContributionCommentCreationId = (id: string): boolean =>
  CONTRIBUTION_COMMENT_CREATION_ID.test(id)
