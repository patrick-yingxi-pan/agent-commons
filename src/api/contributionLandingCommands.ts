/** Transport and authoritative desired-state reconciliation for Contribution landing. */
import type { Contribution } from '../../contract/index.ts'
import { apiGet, apiPost } from './client.ts'
import { invalidate, mutate, peek, setData } from './cache.ts'
import { keys, paths } from './keys.ts'

export interface ContributionLandingIntent {
  readonly intentId: string
  readonly tenantId: string
  readonly projectId: string
  readonly contributionId: string
}

const represented = (contribution: Contribution, intent: ContributionLandingIntent): boolean =>
  contribution.id === intent.contributionId &&
  contribution.projectId === intent.projectId &&
  contribution.status === 'landed' &&
  Number.isSafeInteger(contribution.landingNumber) &&
  (contribution.landingNumber ?? 0) > 0

/** Merge only the addressed terminal row. Once the cache already holds a landed
 * row, retain it: a delayed acknowledgement must not erase notes appended after
 * the landing response was serialized. */
function acceptLanding(intent: ContributionLandingIntent, contribution: Contribution): void {
  if (peek<Contribution[]>(keys.contributions(intent.projectId))) {
    mutate<Contribution[]>(keys.contributions(intent.projectId), (current) => {
      const rows = (current ?? []).map((candidate) =>
        candidate.id === contribution.id && candidate.status !== 'landed'
          ? contribution
          : candidate,
      )
      const band = (candidate: Contribution) => candidate.status === 'open' ? 0 : 1
      return rows.sort(
        (a, b) => band(a) - band(b) ||
          (b.landingNumber ?? 0) - (a.landingNumber ?? 0) ||
          b.openedAt - a.openedAt,
      )
    })
  }
  invalidate(keys.contributions(intent.projectId))
  invalidate(keys.attention(intent.projectId))
}

export async function applyContributionLanding(
  intent: ContributionLandingIntent,
  idempotencyKey: string,
): Promise<void> {
  const contribution = await apiPost<Contribution>(
    paths.contributionLand(intent.projectId, intent.contributionId),
    {},
    { idempotencyKey },
  )
  if (!represented(contribution, intent)) {
    throw new Error('The landing acknowledgement did not match the requested Contribution.')
  }
  acceptLanding(intent, contribution)
}

export async function reconcileContributionLanding(
  intent: ContributionLandingIntent,
): Promise<boolean> {
  const incoming = await apiGet<Contribution[]>(paths.contributions(intent.projectId))
  const contribution = incoming.find((candidate) => represented(candidate, intent))
  if (!peek<Contribution[]>(keys.contributions(intent.projectId))) {
    setData(keys.contributions(intent.projectId), incoming)
  }
  if (!contribution) return false
  acceptLanding(intent, contribution)
  return true
}
