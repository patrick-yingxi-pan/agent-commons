/** Transport and exact-receipt reconciliation for owner-selected Contribution review. */
import type { Contribution, ReviewContributionRequest } from '../../contract/contributions.ts'
import type { ContributionReviewRun, ContributionReviewerBinding } from '../../contract/contributionReview.ts'
import { apiGet, apiPost } from './client.ts'
import { invalidate, mutate, peek, setData } from './cache.ts'
import { contributionReviewId } from './contributionReviewIdentity.ts'
import { keys, paths } from './keys.ts'

export interface ContributionReviewIntent {
  readonly intentId: string
  readonly tenantId: string
  readonly projectId: string
  readonly contributionId: string
  readonly expectedVersion: number
  readonly reviewer: ContributionReviewerBinding
  /** Frozen display-only context used to reconstruct the held act after navigation. */
  readonly reviewerLabel: string
  readonly providerLabel: string
  readonly modelLabel: string
  readonly budgetLabel: string
}

function receiptFor(
  contribution: Contribution,
  expectedId: string,
  expectedVersion: number,
): ContributionReviewRun | undefined {
  return contribution.reviews?.find((review) =>
    review.id === expectedId && review.version === expectedVersion)
}

function mergeReview(
  contribution: Contribution,
  receipt: ContributionReviewRun,
): Contribution {
  const reviews = contribution.reviews ?? []
  let merged: ContributionReviewRun[]
  const existing = reviews.findIndex((review) => review.id === receipt.id)
  if (existing >= 0) {
    const prior = reviews[existing]!
    if (prior.status !== 'pending' || receipt.status === 'pending') return contribution
    merged = reviews.map((review) => review.id === receipt.id ? receipt : review)
  } else {
    merged = [...reviews, receipt].sort((a, b) => a.startedAt - b.startedAt)
  }
  if ((contribution.changeset?.length ?? 0) !== receipt.version) {
    return { ...contribution, reviews: merged }
  }
  const latestForVersion = merged.filter((review) => review.version === receipt.version).at(-1)
  const { reviewedVersion: _oldStamp, ...withoutCurrentStamp } = contribution
  return latestForVersion?.status === 'passed'
    ? { ...contribution, reviews: merged, reviewedVersion: receipt.version }
    : { ...withoutCurrentStamp, reviews: merged }
}

/** Preserve current Contribution truth; only append this keyed review receipt. */
function rememberReview(
  intent: ContributionReviewIntent,
  contribution: Contribution,
  expectedId: string,
): void {
  const receipt = receiptFor(contribution, expectedId, intent.expectedVersion)
  if (receipt && peek<Contribution[]>(keys.contributions(intent.projectId))) {
    mutate<Contribution[]>(keys.contributions(intent.projectId), (current) =>
      (current ?? []).map((candidate) =>
        candidate.id === intent.contributionId ? mergeReview(candidate, receipt) : candidate,
      ),
    )
  }
  invalidate(keys.contributions(intent.projectId))
  invalidate(keys.attention(intent.projectId))
}

async function receiptId(intent: ContributionReviewIntent, idempotencyKey: string): Promise<string> {
  return contributionReviewId(
    intent.tenantId,
    intent.projectId,
    intent.contributionId,
    idempotencyKey,
  )
}

export async function applyContributionReview(
  intent: ContributionReviewIntent,
  idempotencyKey: string,
): Promise<void> {
  const expectedId = await receiptId(intent, idempotencyKey)
  const request: ReviewContributionRequest = {
    expectedVersion: intent.expectedVersion,
    reviewer: intent.reviewer,
  }
  const contribution = await apiPost<Contribution>(
    paths.contributionReview(intent.projectId, intent.contributionId),
    request,
    { idempotencyKey },
  )
  const receipt = receiptFor(contribution, expectedId, intent.expectedVersion)
  if (!receipt) {
    throw new Error('The review acknowledgement did not match this reviewer and frozen changeset version.')
  }
  // A keyed pending receipt is durable transport truth too. The page will keep
  // it visibly pending and block another paid dispatch until a later read settles it.
  rememberReview(intent, contribution, expectedId)
}

export async function reconcileContributionReview(
  intent: ContributionReviewIntent,
  _baseline: undefined,
  idempotencyKey: string,
): Promise<boolean> {
  const expectedId = await receiptId(intent, idempotencyKey)
  const incoming = await apiGet<Contribution[]>(paths.contributions(intent.projectId))
  const contribution = incoming.find((candidate) => candidate.id === intent.contributionId)
  const receipt = contribution
    ? receiptFor(contribution, expectedId, intent.expectedVersion)
    : undefined
  if (!peek<Contribution[]>(keys.contributions(intent.projectId))) {
    setData(keys.contributions(intent.projectId), incoming)
  } else if (contribution && receipt) {
    rememberReview(intent, contribution, expectedId)
  }
  return receipt !== undefined
}
