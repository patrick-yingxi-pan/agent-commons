import type { Delegation } from '../../contract/index.ts'

/** Merge one exact reconciliation result without replacing unrelated roster
 * truth that may have arrived after the authoritative read began. */
export function mergeDelegationRevocationRoster(
  current: Delegation[],
  delegationId: string,
  represented: Delegation | undefined,
): Delegation[] {
  if (!represented) return current.filter((delegation) => delegation.id !== delegationId)
  return current.some((delegation) => delegation.id === delegationId)
    ? current.map((delegation) => delegation.id === delegationId &&
      (represented.revision ?? 0) >= (delegation.revision ?? 0) ? represented : delegation)
    : [...current, represented]
}
