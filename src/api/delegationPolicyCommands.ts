/** Acknowledged transport and exact version reconciliation for policy edits. */
import { ESCALATION_TRIGGERS } from '../../contract/delegations.ts'
import type { Delegation, DelegationPolicyVersion, PatchDelegationRequest } from '../../contract/index.ts'
import { apiGet, apiPatch } from './client.ts'
import { invalidate, mutate, peek } from './cache.ts'
import { keys, paths } from './keys.ts'
import { preferNewerDelegation } from './delegationRevision.ts'
import type { DelegationPolicyIntent } from './delegationPolicyRevision.ts'

function canonicalEscalation(triggers: readonly string[]): string[] {
  const selected = new Set(triggers)
  selected.add('effectful')
  return ESCALATION_TRIGGERS.filter((trigger) => selected.has(trigger))
}

function sameVersion(version: DelegationPolicyVersion, request: PatchDelegationRequest): boolean {
  return version.revision === request.expectedRevision + 1
    && version.policy === request.policy
    && version.mode === request.mode
    && (version.expiresAt ?? null) === request.expiresAt
    && JSON.stringify(canonicalEscalation(version.escalation))
      === JSON.stringify(canonicalEscalation(request.escalation))
}

function publish(projectId: string, delegation: Delegation): void {
  if (peek<Delegation[]>(keys.delegations(projectId))) {
    mutate<Delegation[]>(keys.delegations(projectId), (current) => {
      const rows = current ?? []
      return rows.map((row) => row.id === delegation.id ? preferNewerDelegation(row, delegation) : row)
    })
  }
  invalidate(keys.delegations(projectId))
  invalidate(keys.attention(projectId))
}

export async function applyDelegationPolicy(
  intent: DelegationPolicyIntent,
  idempotencyKey: string,
): Promise<void> {
  const delegation = await apiPatch<Delegation>(
    paths.delegation(intent.projectId, intent.delegationId),
    intent.request,
    { idempotencyKey },
  )
  publish(intent.projectId, delegation)
}

/** Exact version history proves this request even after newer edits arrive. */
export async function reconcileDelegationPolicy(intent: DelegationPolicyIntent): Promise<boolean> {
  const incoming = await apiGet<Delegation[]>(paths.delegations(intent.projectId))
  const represented = incoming.find((row) => row.id === intent.delegationId)
  const versions = represented?.versions ?? []
  const realized = versions.some((version) => sameVersion(version, intent.request))
  if (represented) publish(intent.projectId, represented)
  else invalidate(keys.delegations(intent.projectId))
  return realized
}

export function delegationPolicyVersionMatches(
  version: DelegationPolicyVersion,
  request: PatchDelegationRequest,
): boolean {
  return sameVersion(version, request)
}
