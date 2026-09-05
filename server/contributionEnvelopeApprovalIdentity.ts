/** Durable public receipt identity for one logical Contribution envelope
 * approval. Tenant and containment participate so a retry key cannot alias
 * another account or ledger row; the reviewed version is proved by the event. */
import { createHash } from 'node:crypto'

const CONTRIBUTION_ENVELOPE_APPROVAL_ID = /^contribution-envelope-approval-[a-f0-9]{24}$/

export function contributionEnvelopeApprovalId(
  tenantId: string,
  projectId: string,
  contributionId: string,
  idempotencyKey: string,
): string {
  const digest = createHash('sha256')
    .update(`${tenantId}\0${projectId}\0${contributionId}\0${idempotencyKey}`)
    .digest('hex')
    .slice(0, 24)
  return `contribution-envelope-approval-${digest}`
}

export const isContributionEnvelopeApprovalId = (id: string): boolean =>
  CONTRIBUTION_ENVELOPE_APPROVAL_ID.test(id)
