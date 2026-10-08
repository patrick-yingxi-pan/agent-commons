/** One-shot real MCP effect transport and receipt-only recovery. */
import type { Contribution, ContributionEffectRun } from '../../contract/index.ts'
import { apiGet, apiPost } from './client.ts'
import { invalidate } from './cache.ts'
import { contributionEffectExecutionId } from './contributionEffectExecutionIdentity.ts'
import { keys, paths } from './keys.ts'

export interface ContributionMcpEffectIntent {
  readonly tenantId: string
  readonly sourceUserId: string | null
  readonly projectId: string
  readonly contributionId: string
  readonly lineId: string
  readonly expectedVersion: number
}

export interface ContributionMcpEffectReceipt {
  contribution: Contribution
  receipt: ContributionEffectRun
}

function exactReceipt(
  contribution: Contribution | undefined,
  intent: ContributionMcpEffectIntent,
  receiptId: string,
): ContributionMcpEffectReceipt | undefined {
  if (!contribution || contribution.id !== intent.contributionId || contribution.projectId !== intent.projectId) return undefined
  const receipt = contribution.effects?.find((candidate) =>
    candidate.id === receiptId &&
    candidate.lineId === intent.lineId &&
    candidate.envelopeVersion === intent.expectedVersion)
  return receipt ? { contribution, receipt } : undefined
}

/** This is intentionally one POST. Any missing/malformed acknowledgement is
 * resolved by a separate collection read; this function never retries it. */
export async function submitContributionMcpEffectOnce(
  intent: ContributionMcpEffectIntent,
  idempotencyKey: string,
): Promise<ContributionMcpEffectReceipt> {
  const receiptId = await contributionEffectExecutionId(intent.tenantId, intent.projectId, intent.contributionId, idempotencyKey)
  const contribution = await apiPost<Contribution>(
    paths.contributionEffects(intent.projectId, intent.contributionId),
    { lineId: intent.lineId, expectedVersion: intent.expectedVersion },
    { idempotencyKey, expectedSessionUserId: intent.sourceUserId },
  )
  const receipt = exactReceipt(contribution, intent, receiptId)
  if (!receipt) throw new Error('The effect acknowledgement did not include its exact saved receipt.')
  invalidate(keys.contributions(intent.projectId))
  invalidate(keys.attention(intent.projectId))
  return receipt
}

/** Recovery is read-only and can never replay the external act. */
export async function readContributionMcpEffectReceipt(
  intent: ContributionMcpEffectIntent,
  idempotencyKey: string,
): Promise<ContributionMcpEffectReceipt | undefined> {
  const receiptId = await contributionEffectExecutionId(intent.tenantId, intent.projectId, intent.contributionId, idempotencyKey)
  const contributions = await apiGet<Contribution[]>(paths.contributions(intent.projectId), {
    expectedSessionUserId: intent.sourceUserId,
  })
  const receipt = exactReceipt(contributions.find((candidate) => candidate.id === intent.contributionId), intent, receiptId)
  invalidate(keys.contributions(intent.projectId))
  invalidate(keys.attention(intent.projectId))
  return receipt
}
