/** Transport and exact-receipt reconciliation for Contribution crystallization. */
import type { ChangesetVersion, Contribution, ContributionEvent, CrystallizeRequest } from '../../contract/index.ts'
import { apiGet, apiPost } from './client.ts'
import { invalidate, mutate, peek, setData } from './cache.ts'
import { contributionCrystallizationId } from './contributionCrystallizationIdentity.ts'
import { keys, paths } from './keys.ts'

export interface ContributionCrystallizationIntent {
  readonly intentId: string
  readonly tenantId: string
  readonly projectId: string
  readonly contributionId: string
  readonly entries: CrystallizeRequest['entries']
}

interface CrystallizationReceipt {
  event: ContributionEvent
  version: ChangesetVersion
}

const receiptFor = (
  contribution: Contribution,
  expectedId: string,
): CrystallizationReceipt | undefined => {
  const event = contribution.events.find((candidate) =>
    candidate.id === expectedId &&
    candidate.kind === 'crystallized' &&
    Number.isSafeInteger(candidate.changesetVersion) &&
    (candidate.changesetVersion ?? 0) > 0)
  const version = event
    ? contribution.changeset?.find((candidate) => candidate.version === event.changesetVersion)
    : undefined
  return event && version ? { event, version } : undefined
}

/** Merge only the exact append-only version and its receipt. Later comments,
 * envelope work, review state, and newer changeset versions stay untouched. */
function rememberCrystallization(
  intent: ContributionCrystallizationIntent,
  contribution: Contribution,
  expectedId: string,
): void {
  const receipt = receiptFor(contribution, expectedId)
  if (receipt && peek<Contribution[]>(keys.contributions(intent.projectId))) {
    mutate<Contribution[]>(keys.contributions(intent.projectId), (current) =>
      (current ?? []).map((candidate) => {
        if (candidate.id !== contribution.id) return candidate
        const events = candidate.events.some((event) => event.id === receipt.event.id)
          ? candidate.events
          : [...candidate.events, receipt.event].sort((a, b) => a.at - b.at)
        const priorVersions = candidate.changeset ?? []
        const changeset = priorVersions.some((version) => version.version === receipt.version.version)
          ? priorVersions
          : [...priorVersions, receipt.version].sort((a, b) => a.version - b.version)
        const currentLatest = priorVersions.at(-1)?.version ?? 0
        return {
          ...candidate,
          events,
          changeset,
          ...(currentLatest <= receipt.version.version && contribution.tier ? { tier: contribution.tier } : {}),
        }
      }),
    )
  }
  invalidate(keys.contributions(intent.projectId))
  invalidate(keys.attention(intent.projectId))
}

export async function applyContributionCrystallization(
  intent: ContributionCrystallizationIntent,
  idempotencyKey: string,
): Promise<void> {
  const expectedId = await contributionCrystallizationId(
    intent.tenantId,
    intent.projectId,
    intent.contributionId,
    idempotencyKey,
  )
  const contribution = await apiPost<Contribution>(
    paths.contributionChangeset(intent.projectId, intent.contributionId),
    { entries: intent.entries } satisfies CrystallizeRequest,
    { idempotencyKey },
  )
  if (!receiptFor(contribution, expectedId)) {
    throw new Error('The crystallization acknowledgement did not match the requested Contribution version.')
  }
  rememberCrystallization(intent, contribution, expectedId)
}

export async function reconcileContributionCrystallization(
  intent: ContributionCrystallizationIntent,
  _baseline: undefined,
  idempotencyKey: string,
): Promise<boolean> {
  const expectedId = await contributionCrystallizationId(
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
  } else if (contribution && receipt) {
    rememberCrystallization(intent, contribution, expectedId)
  }
  return receipt !== undefined
}
