/** One mutual-exclusion gate for Contributor configuration and removal.
 * Leases are generation-stamped so a late old-account settlement cannot release
 * a same-id hold created after an account switch. */
import { onAccountSwitch } from '../api/account.ts'

type CommissionMutationKind = 'configuration' | 'deletion'

export interface CommissionMutationLease {
  readonly generation: number
  readonly id: string
  readonly kind: CommissionMutationKind
}

const counts: Record<CommissionMutationKind, Map<string, number>> = {
  configuration: new Map(),
  deletion: new Map(),
}
let generation = 0

const otherKind = (kind: CommissionMutationKind): CommissionMutationKind =>
  kind === 'configuration' ? 'deletion' : 'configuration'

export function acquireCommissionMutation(
  kind: CommissionMutationKind,
  id: string,
): CommissionMutationLease | null {
  if ((counts[otherKind(kind)].get(id) ?? 0) > 0) return null
  counts[kind].set(id, (counts[kind].get(id) ?? 0) + 1)
  return { generation, id, kind }
}

export function releaseCommissionMutation(lease: CommissionMutationLease): void {
  if (lease.generation !== generation) return
  const remaining = Math.max(0, (counts[lease.kind].get(lease.id) ?? 0) - 1)
  if (remaining === 0) counts[lease.kind].delete(lease.id)
  else counts[lease.kind].set(lease.id, remaining)
}

export const isCommissionConfigurationHeld = (id: string): boolean =>
  (counts.configuration.get(id) ?? 0) > 0

export const isCommissionDeletionHeld = (id: string): boolean =>
  (counts.deletion.get(id) ?? 0) > 0

onAccountSwitch(() => {
  generation += 1
  counts.configuration.clear()
  counts.deletion.clear()
})
