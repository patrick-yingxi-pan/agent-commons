/** Transport and monotonic reconciliation for requiring Contribution review. */
import type { Contribution, ContributionEvent } from '../../contract/index.ts'
import { apiGet, apiPost } from './client.ts'
import { invalidate, mutate, peek, setData } from './cache.ts'
import { contributionReviewRequirementId } from './contributionReviewRequirementIdentity.ts'
import { keys, paths } from './keys.ts'

export interface ContributionReviewRequirementIntent {
  readonly intentId: string
  readonly tenantId: string
  readonly projectId: string
  readonly contributionId: string
}

const receiptFor = (
  contribution: Contribution,
  expectedId: string,
): ContributionEvent | undefined => contribution.events.find((event) =>
  event.id === expectedId && event.kind === 'review-required')

/** Merge only the monotonic flag and exact receipt. Live tier arithmetic,
 * lifecycle, changesets, envelopes, reviews, and later history remain truth. */
function rememberRequirement(
  intent: ContributionReviewRequirementIntent,
  contribution: Contribution,
  expectedId: string,
): void {
  const receipt = receiptFor(contribution, expectedId)
  if (receipt && contribution.reviewRequired === true && peek<Contribution[]>(keys.contributions(intent.projectId))) {
    mutate<Contribution[]>(keys.contributions(intent.projectId), (current) =>
      (current ?? []).map((candidate) => {
        if (candidate.id !== contribution.id) return candidate
        const events = candidate.events.some((event) => event.id === receipt.id)
          ? candidate.events
          : [...candidate.events, receipt].sort((a, b) => a.at - b.at)
        return { ...candidate, reviewRequired: true, events }
      }),
    )
  }
  invalidate(keys.contributions(intent.projectId))
  invalidate(keys.attention(intent.projectId))
}

export async function applyContributionReviewRequirement(
  intent: ContributionReviewRequirementIntent,
  idempotencyKey: string,
): Promise<void> {
  const expectedId = await contributionReviewRequirementId(
    intent.tenantId,
    intent.projectId,
    intent.contributionId,
    idempotencyKey,
  )
  const contribution = await apiPost<Contribution>(
    paths.contributionRequireReview(intent.projectId, intent.contributionId),
    {},
    { idempotencyKey },
  )
  if (contribution.reviewRequired !== true || !receiptFor(contribution, expectedId)) {
    throw new Error('The review-requirement acknowledgement did not match this exact tightening request.')
  }
  rememberRequirement(intent, contribution, expectedId)
}

export async function reconcileContributionReviewRequirement(
  intent: ContributionReviewRequirementIntent,
  _baseline: undefined,
  idempotencyKey: string,
): Promise<boolean> {
  const expectedId = await contributionReviewRequirementId(
    intent.tenantId,
    intent.projectId,
    intent.contributionId,
    idempotencyKey,
  )
  const incoming = await apiGet<Contribution[]>(paths.contributions(intent.projectId))
  const contribution = incoming.find((candidate) => candidate.id === intent.contributionId)
  const receipt = contribution ? receiptFor(contribution, expectedId) : undefined
  if (!peek<Contribution[]>(keys.contributions(intent.projectId))) {
    setData(keys.contributions(intent.projectId), incoming)
  } else if (contribution && contribution.reviewRequired === true && receipt) {
    rememberRequirement(intent, contribution, expectedId)
  }
  return contribution?.reviewRequired === true && receipt !== undefined
}
