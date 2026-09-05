/** Durable public receipt identity for one logical Contribution effect-envelope
 * proposal. Tenant and containment participate so a retry key cannot alias
 * another account or ledger row; the exact payload stays server-proved. */
import { createHash } from 'node:crypto'

const CONTRIBUTION_ENVELOPE_PROPOSAL_ID = /^contribution-envelope-proposal-[a-f0-9]{24}$/

export function contributionEnvelopeProposalId(
  tenantId: string,
  projectId: string,
  contributionId: string,
  idempotencyKey: string,
): string {
  const digest = createHash('sha256')
    .update(`${tenantId}\0${projectId}\0${contributionId}\0${idempotencyKey}`)
    .digest('hex')
    .slice(0, 24)
  return `contribution-envelope-proposal-${digest}`
}

export const isContributionEnvelopeProposalId = (id: string): boolean =>
  CONTRIBUTION_ENVELOPE_PROPOSAL_ID.test(id)
