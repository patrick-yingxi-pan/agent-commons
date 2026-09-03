/** Provider-specific exclusion across definition, connection, and removal. */
import {
  createExclusiveMutationHolds,
  type ExclusiveMutationLease,
} from './exclusiveMutationHolds.ts'

type ProviderMutationKind = 'definition' | 'connection' | 'deletion'
const holds = createExclusiveMutationHolds<ProviderMutationKind>([
  'definition',
  'connection',
  'deletion',
])

export type ProviderMutationLease = ExclusiveMutationLease<ProviderMutationKind>
export const acquireProviderMutation = holds.acquire
export const releaseProviderMutation = holds.release
export const isProviderDefinitionHeld = (id: string): boolean => holds.isHeld('definition', id)
export const isProviderConnectionHeld = (id: string): boolean => holds.isHeld('connection', id)
export const isProviderDeletionHeld = (id: string): boolean => holds.isHeld('deletion', id)
