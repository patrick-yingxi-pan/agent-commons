/** Transport and exact authoritative reconciliation for Delegation creation. */
import type { Delegation } from '../../contract/index.ts'
import { apiGet, apiPost } from './client.ts'
import { invalidate, mutate, peek, setData } from './cache.ts'
import { delegationCreationId } from './delegationCreationIdentity.ts'
import type { DelegationCreationIntent } from './delegationCreationRevision.ts'
import { keys, paths } from './keys.ts'

function remember(projectId: string, delegation: Delegation): void {
  if (peek<Delegation[]>(keys.delegations(projectId))) {
    mutate<Delegation[]>(keys.delegations(projectId), (current) => {
      const rows = current ?? []
      return rows.some((candidate) => candidate.id === delegation.id)
        ? rows.map((candidate) => candidate.id === delegation.id ? delegation : candidate)
        : [...rows, delegation]
    })
  }
  // Roster and derived attention may move independently after acknowledgement.
  invalidate(keys.delegations(projectId))
  invalidate(keys.attention(projectId))
}

export async function applyDelegationCreation(
  intent: DelegationCreationIntent,
  idempotencyKey: string,
): Promise<void> {
  const delegation = await apiPost<Delegation>(
    paths.delegations(intent.projectId),
    intent.request,
    { idempotencyKey },
  )
  remember(intent.projectId, delegation)
}

/** Prove only the row derived from this tenant, Project, and form submission. */
export async function reconcileDelegationCreation(
  intent: DelegationCreationIntent,
  idempotencyKey: string,
): Promise<boolean> {
  const expectedId = await delegationCreationId(
    intent.tenantId,
    intent.projectId,
    idempotencyKey,
  )
  const incoming = await apiGet<Delegation[]>(paths.delegations(intent.projectId))
  const represented = incoming.find((delegation) => delegation.id === expectedId)
  const current = peek<Delegation[]>(keys.delegations(intent.projectId))
  if (!current) setData(keys.delegations(intent.projectId), incoming)
  else if (represented) remember(intent.projectId, represented)
  if (!represented) return false
  if (!current) {
    invalidate(keys.delegations(intent.projectId))
    invalidate(keys.attention(intent.projectId))
  }
  return true
}
