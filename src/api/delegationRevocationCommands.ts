/** Transport and exact roster reconciliation for Delegation revocation. */
import type { Delegation, DeleteDelegationRequest } from '../../contract/index.ts'
import { apiDelete, apiGet } from './client.ts'
import { invalidate, mutate, peek, setData } from './cache.ts'
import { mergeDelegationRevocationRoster } from './delegationRevocationRoster.ts'
import { keys, paths } from './keys.ts'

function rememberTarget(
  projectId: string,
  delegationId: string,
  represented: Delegation | undefined,
): void {
  const current = peek<Delegation[]>(keys.delegations(projectId))
  if (!current) return
  mutate<Delegation[]>(keys.delegations(projectId), (rows) =>
    mergeDelegationRevocationRoster(rows ?? [], delegationId, represented))
}

export async function applyDelegationRevocation(
  projectId: string,
  delegationId: string,
  expectedCreatedAt: number,
  idempotencyKey: string,
): Promise<void> {
  await apiDelete<{ ok: true }>(
    paths.delegation(projectId, delegationId),
    { expectedCreatedAt } satisfies DeleteDelegationRequest,
    { idempotencyKey },
  )
  rememberTarget(projectId, delegationId, undefined)
  invalidate(keys.delegations(projectId))
  invalidate(keys.attention(projectId))
}

/** Adopt only the addressed row from a full authoritative roster read. This
 * proves desired absence without letting an older reconciliation erase later,
 * unrelated Delegation creation. */
export async function reconcileDelegationRevocation(
  projectId: string,
  delegationId: string,
): Promise<Delegation | null> {
  const incoming = await apiGet<Delegation[]>(paths.delegations(projectId))
  const represented = incoming.find((delegation) => delegation.id === delegationId)
  if (peek<Delegation[]>(keys.delegations(projectId))) {
    rememberTarget(projectId, delegationId, represented)
  } else {
    setData(keys.delegations(projectId), incoming)
  }
  invalidate(keys.attention(projectId))
  return represented ?? null
}
