/** Transport and monotonic reconciliation for Contribution comments. */
import type { Contribution, ContributionEvent } from '../../contract/index.ts'
import { apiGet, apiPost } from './client.ts'
import { invalidate, mutate, peek, setData } from './cache.ts'
import { contributionCommentCreationId } from './contributionCommentCreationIdentity.ts'
import { keys, paths } from './keys.ts'

export interface ContributionCommentCreationIntent {
  readonly intentId: string
  readonly tenantId: string
  readonly projectId: string
  readonly contributionId: string
  readonly body: string
}

const exactComment = (
  contribution: Contribution,
  intent: ContributionCommentCreationIntent,
  expectedId: string,
): ContributionEvent | undefined => contribution.events.find((event) =>
  event.id === expectedId &&
  event.kind === 'note' &&
  event.body === intent.body)

/** Append only the exact receipt. A delayed acknowledgement must not replace a
 * landing, review, envelope, changeset, or any later timeline history. */
function rememberComment(
  intent: ContributionCommentCreationIntent,
  contribution: Contribution,
  expectedId: string,
): void {
  const receipt = exactComment(contribution, intent, expectedId)
  if (receipt && peek<Contribution[]>(keys.contributions(intent.projectId))) {
    mutate<Contribution[]>(keys.contributions(intent.projectId), (current) =>
      (current ?? []).map((candidate) => {
        if (candidate.id !== contribution.id) return candidate
        if (candidate.events.some((event) => event.id === receipt.id)) return candidate
        return {
          ...candidate,
          events: [...candidate.events, receipt].sort((a, b) => a.at - b.at),
        }
      }),
    )
  }
  invalidate(keys.contributions(intent.projectId))
}

export async function applyContributionCommentCreation(
  intent: ContributionCommentCreationIntent,
  idempotencyKey: string,
): Promise<void> {
  const expectedId = await contributionCommentCreationId(
    intent.tenantId,
    intent.projectId,
    intent.contributionId,
    idempotencyKey,
  )
  const contribution = await apiPost<Contribution>(
    paths.contributionComments(intent.projectId, intent.contributionId),
    { body: intent.body },
    { idempotencyKey },
  )
  if (!exactComment(contribution, intent, expectedId)) {
    throw new Error('The comment acknowledgement did not match the exact submitted comment.')
  }
  rememberComment(intent, contribution, expectedId)
}

export async function reconcileContributionCommentCreation(
  intent: ContributionCommentCreationIntent,
  _baseline: undefined,
  idempotencyKey: string,
): Promise<boolean> {
  const expectedId = await contributionCommentCreationId(
    intent.tenantId,
    intent.projectId,
    intent.contributionId,
    idempotencyKey,
  )
  const incoming = await apiGet<Contribution[]>(paths.contributions(intent.projectId))
  const contribution = incoming.find((candidate) => candidate.id === intent.contributionId)
  const receipt = contribution ? exactComment(contribution, intent, expectedId) : undefined
  if (!peek<Contribution[]>(keys.contributions(intent.projectId))) {
    setData(keys.contributions(intent.projectId), incoming)
  } else if (contribution && receipt) {
    rememberComment(intent, contribution, expectedId)
  }
  return receipt !== undefined
}
