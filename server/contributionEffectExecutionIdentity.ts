/** Durable public receipt identity for one logical Contribution effect attempt.
 * The receipt sits on the Contribution timeline; tenant and containment
 * coordinates participate so one retry key cannot alias another account or
 * ledger row. The line is deliberately NOT part of the identity: a changed
 * retry body must meet the original receipt and be refused, not mint a second
 * act from the same logical key. */
import { createHash } from 'node:crypto'

const CONTRIBUTION_EFFECT_EXECUTION_ID = /^contribution-effect-[a-f0-9]{24}$/

export function contributionEffectExecutionId(
  tenantId: string,
  projectId: string,
  contributionId: string,
  idempotencyKey: string,
): string {
  const digest = createHash('sha256')
    .update(`${tenantId}\0${projectId}\0${contributionId}\0${idempotencyKey}`)
    .digest('hex')
    .slice(0, 24)
  return `contribution-effect-${digest}`
}

export const isContributionEffectExecutionId = (id: string): boolean =>
  CONTRIBUTION_EFFECT_EXECUTION_ID.test(id)
