/** Durable identity for one logical Contribution landing. The operation stays
 * private inside the stored ledger row; tenant and containment coordinates all
 * participate so the same retry key cannot alias another terminal act. */
import { createHash } from 'node:crypto'

const CONTRIBUTION_LANDING_ID = /^contribution-land-[a-f0-9]{24}$/

export function contributionLandingId(
  tenantId: string,
  projectId: string,
  contributionId: string,
  idempotencyKey: string,
): string {
  const digest = createHash('sha256')
    .update(`${tenantId}\0${projectId}\0${contributionId}\0${idempotencyKey}`)
    .digest('hex')
    .slice(0, 24)
  return `contribution-land-${digest}`
}

export const isContributionLandingId = (id: string): boolean =>
  CONTRIBUTION_LANDING_ID.test(id)
