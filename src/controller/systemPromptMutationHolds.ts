/** System-Prompt-specific mutual exclusion between definition and removal. */
import {
  createExclusiveMutationHolds,
  type ExclusiveMutationLease,
} from './exclusiveMutationHolds.ts'

type SystemPromptMutationKind = 'definition' | 'deletion'
const holds = createExclusiveMutationHolds<SystemPromptMutationKind>(['definition', 'deletion'])

export type SystemPromptMutationLease = ExclusiveMutationLease<SystemPromptMutationKind>
export const acquireSystemPromptMutation = holds.acquire
export const releaseSystemPromptMutation = holds.release
export const isSystemPromptDefinitionHeld = (id: string): boolean => holds.isHeld('definition', id)
export const isSystemPromptDeletionHeld = (id: string): boolean => holds.isHeld('deletion', id)
