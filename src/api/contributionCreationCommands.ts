/** Transport and exact authoritative reconciliation for Contribution creation. */
import type { Contribution } from '../../contract/index.ts'
import { apiGet, apiPost } from './client.ts'
import { invalidate, mutate, peek, setData } from './cache.ts'
import { contributionCreationId } from './contributionCreationIdentity.ts'
import type { ContributionCreationIntent } from './contributionCreationRevision.ts'
import { keys, paths } from './keys.ts'

function remember(projectId: string, contribution: Contribution): void {
  if (peek<Contribution[]>(keys.contributions(projectId))) {
    mutate<Contribution[]>(keys.contributions(projectId), (current) => {
      const rows = current ?? []
      return rows.some((candidate) => candidate.id === contribution.id)
        ? rows.map((candidate) => candidate.id === contribution.id ? contribution : candidate)
        : [contribution, ...rows]
    })
  }
  // The ledger and its derived attention may move while acknowledgement is in flight.
  invalidate(keys.contributions(projectId))
  invalidate(keys.attention(projectId))
}

export async function applyContributionCreation(
  intent: ContributionCreationIntent,
  idempotencyKey: string,
): Promise<void> {
  const contribution = await apiPost<Contribution>(
    paths.contributions(intent.projectId),
    intent.request,
    { idempotencyKey },
  )
  remember(intent.projectId, contribution)
}

/** Prove only the row derived from this tenant, Project, and form submission. */
export async function reconcileContributionCreation(
  intent: ContributionCreationIntent,
  idempotencyKey: string,
): Promise<boolean> {
  const expectedId = await contributionCreationId(
    intent.tenantId,
    intent.projectId,
    idempotencyKey,
  )
  const incoming = await apiGet<Contribution[]>(paths.contributions(intent.projectId))
  const represented = incoming.find((contribution) => contribution.id === expectedId)
  const current = peek<Contribution[]>(keys.contributions(intent.projectId))
  if (!current) setData(keys.contributions(intent.projectId), incoming)
  else if (represented) remember(intent.projectId, represented)
  if (!represented) return false
  if (!current) {
    invalidate(keys.contributions(intent.projectId))
    invalidate(keys.attention(intent.projectId))
  }
  return true
}
