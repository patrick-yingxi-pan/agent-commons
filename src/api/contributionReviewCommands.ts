/** Transport and exact-version reconciliation for Contribution review. */
import type { Contribution, ContributionEvent, ReviewContributionRequest } from '../../contract/index.ts'
import { apiGet, apiPost } from './client.ts'
import { invalidate, mutate, peek, setData } from './cache.ts'
import { contributionReviewId } from './contributionReviewIdentity.ts'
import { keys, paths } from './keys.ts'

export interface ContributionReviewIntent {
  readonly intentId: string
  readonly tenantId: string
  readonly projectId: string
  readonly contributionId: string
  readonly reviewedVersion: number
}

const receiptFor = (
  contribution: Contribution,
  expectedId: string,
  reviewedVersion: number,
): ContributionEvent | undefined => contribution.events.find((event) =>
  event.id === expectedId &&
  event.kind === 'review-passed' &&
  event.reviewedVersion === reviewedVersion)

/** Merge only the exact review receipt and a still-current reviewed-version
 * stamp. Later changesets, landing, envelope state, and history remain truth. */
function rememberReview(
  intent: ContributionReviewIntent,
  contribution: Contribution,
  expectedId: string,
): void {
  const receipt = receiptFor(contribution, expectedId, intent.reviewedVersion)
  if (receipt && peek<Contribution[]>(keys.contributions(intent.projectId))) {
    mutate<Contribution[]>(keys.contributions(intent.projectId), (current) =>
      (current ?? []).map((candidate) => {
        if (candidate.id !== contribution.id) return candidate
        const events = candidate.events.some((event) => event.id === receipt.id)
          ? candidate.events
          : [...candidate.events, receipt].sort((a, b) => a.at - b.at)
        const latest = candidate.changeset?.length ?? 0
        const mayAdoptReview =
          latest === intent.reviewedVersion &&
          contribution.reviewedVersion === intent.reviewedVersion
        return {
          ...candidate,
          events,
          ...(mayAdoptReview ? { reviewedVersion: intent.reviewedVersion } : {}),
        }
      }),
    )
  }
  invalidate(keys.contributions(intent.projectId))
  invalidate(keys.attention(intent.projectId))
}

export async function applyContributionReview(
  intent: ContributionReviewIntent,
  idempotencyKey: string,
): Promise<void> {
  const expectedId = await contributionReviewId(
    intent.tenantId,
    intent.projectId,
    intent.contributionId,
    idempotencyKey,
  )
  const contribution = await apiPost<Contribution>(
    paths.contributionReview(intent.projectId, intent.contributionId),
    { expectedVersion: intent.reviewedVersion } satisfies ReviewContributionRequest,
    { idempotencyKey },
  )
  if (!receiptFor(contribution, expectedId, intent.reviewedVersion)) {
    throw new Error('The review acknowledgement did not match the changeset version that was reviewed.')
  }
  rememberReview(intent, contribution, expectedId)
}

export async function reconcileContributionReview(
  intent: ContributionReviewIntent,
  _baseline: undefined,
  idempotencyKey: string,
): Promise<boolean> {
  const expectedId = await contributionReviewId(
    intent.tenantId,
    intent.projectId,
    intent.contributionId,
    idempotencyKey,
  )
  const incoming = await apiGet<Contribution[]>(paths.contributions(intent.projectId))
  const contribution = incoming.find((candidate) => candidate.id === intent.contributionId)
  const receipt = contribution
    ? receiptFor(contribution, expectedId, intent.reviewedVersion)
    : undefined
  if (!peek<Contribution[]>(keys.contributions(intent.projectId))) {
    setData(keys.contributions(intent.projectId), incoming)
  } else if (contribution && receipt) {
    rememberReview(intent, contribution, expectedId)
  }
  return receipt !== undefined
}
