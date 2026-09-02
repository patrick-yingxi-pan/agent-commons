/** Agent-specific mutual exclusion between configuration and removal. */
import {
  createExclusiveMutationHolds,
  type ExclusiveMutationLease,
} from './exclusiveMutationHolds.ts'

type AgentMutationKind = 'configuration' | 'deletion'
const holds = createExclusiveMutationHolds<AgentMutationKind>(['configuration', 'deletion'])

export type AgentMutationLease = ExclusiveMutationLease<AgentMutationKind>
export const acquireAgentMutation = holds.acquire
export const releaseAgentMutation = holds.release
export const isAgentConfigurationHeld = (id: string): boolean => holds.isHeld('configuration', id)
export const isAgentDeletionHeld = (id: string): boolean => holds.isHeld('deletion', id)
