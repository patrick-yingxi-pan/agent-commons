/** Contributor-specific face of the shared mutation-exclusion primitive. */
import {
  createExclusiveMutationHolds,
  type ExclusiveMutationLease,
} from './exclusiveMutationHolds.ts'

type CommissionMutationKind = 'configuration' | 'deletion'
const holds = createExclusiveMutationHolds<CommissionMutationKind>(['configuration', 'deletion'])

export type CommissionMutationLease = ExclusiveMutationLease<CommissionMutationKind>

export function acquireCommissionMutation(
  kind: CommissionMutationKind,
  id: string,
): CommissionMutationLease | null {
  return holds.acquire(kind, id)
}

export function releaseCommissionMutation(lease: CommissionMutationLease): void {
  holds.release(lease)
}

export const isCommissionConfigurationHeld = (id: string): boolean =>
  holds.isHeld('configuration', id)

export const isCommissionDeletionHeld = (id: string): boolean =>
  holds.isHeld('deletion', id)
