/** Transport and exact authoritative reconciliation for Contributor creation. */
import type { Commission } from '../../contract/index.ts'
import { apiGet, apiPost } from './client.ts'
import { invalidate, invalidatePrefix, peek, setData } from './cache.ts'
import { keys, paths } from './keys.ts'
import { mergeCommissionIntoCachedRosters } from './commissionRosterCache.ts'
import { commissionCreationId } from './commissionCreationIdentity.ts'
import type { CommissionCreationIntent } from './commissionCreationRevision.ts'

function remember(commission: Commission): void {
  const projectId = commission.projectId
  mergeCommissionIntoCachedRosters(commission, projectId)
  // The rosters may change independently while acknowledgement is in flight.
  // Publish only the addressed row now, then revalidate their owning lists.
  invalidate(keys.commissions(projectId))
  invalidate(keys.commissions())
  invalidatePrefix(keys.directoryProjects())
}

export async function applyCommissionCreation(
  intent: CommissionCreationIntent,
  idempotencyKey: string,
): Promise<void> {
  const commission = await apiPost<Commission>(
    paths.commissions(),
    intent.request,
    { idempotencyKey },
  )
  remember(commission)
}

/** Prove only the assignment derived from this account and picker choice. */
export async function reconcileCommissionCreation(
  intent: CommissionCreationIntent,
  idempotencyKey: string,
): Promise<boolean> {
  const expectedId = await commissionCreationId(intent.tenantId, idempotencyKey)
  const projectId = intent.request.projectId
  const incoming = await apiGet<Commission[]>(paths.commissions(projectId))
  const represented = incoming.find((commission) => commission.id === expectedId)
  const current = peek<Commission[]>(keys.commissions(projectId))
  if (!current) setData(keys.commissions(projectId), incoming)
  else if (represented) remember(represented)
  if (!represented) return false
  if (!current) {
    invalidate(keys.commissions(projectId))
    invalidate(keys.commissions())
    invalidatePrefix(keys.directoryProjects())
  }
  return true
}
