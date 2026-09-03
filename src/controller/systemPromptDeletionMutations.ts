/** Eager held-state facade for acknowledgement-owned System Prompt removal. */
import type { SystemPromptEntry } from '../../contract/index.ts'
import { onAccountSwitch } from '../api'
import { createMutationStatusStore } from './mutationStatusStore.ts'
import {
  IDLE_REVISIONED_MUTATION,
  type RevisionedMutationOutcome,
} from './revisionedMutationCore.ts'
import {
  acquireSystemPromptMutation,
  isSystemPromptDeletionHeld,
  releaseSystemPromptMutation,
} from './systemPromptMutationHolds.ts'

export const SYSTEM_PROMPT_DELETE_SCOPE =
  'This permanently removes the reusable prompt from your library and clears its default selection. Agents using it block removal until you choose another prompt; their copied instructions and previous conversations are not changed by this request.'

const statusStore = createMutationStatusStore()
const heldSnapshots = new Map<string, SystemPromptEntry>()
let accountGeneration = 0
export const publishSystemPromptDeletionStatus = statusStore.publish

type Runtime = typeof import('./systemPromptDeletionMutationRuntime.ts')
let runtime: Runtime | null = null
let runtimePromise: Promise<Runtime> | null = null
const loadRuntime = (): Promise<Runtime> => {
  runtimePromise ??= import('./systemPromptDeletionMutationRuntime.ts').then((loaded) => {
    runtime = loaded
    return loaded
  })
  return runtimePromise
}

onAccountSwitch(() => {
  accountGeneration += 1
  heldSnapshots.clear()
  if (runtime) runtime.clearSystemPromptDeletions()
  else statusStore.publish(IDLE_REVISIONED_MUTATION)
})

export { isSystemPromptDeletionHeld }
export const heldSystemPromptDeletions = (): SystemPromptEntry[] => [...heldSnapshots.values()]

export function enqueueSystemPromptDeletion(
  prompt: SystemPromptEntry,
): Promise<RevisionedMutationOutcome> {
  const lease = acquireSystemPromptMutation('deletion', prompt.id)
  if (!lease) return Promise.resolve('discarded')
  const issuedGeneration = accountGeneration
  heldSnapshots.set(prompt.id, prompt)
  statusStore.refresh()
  const outcome = loadRuntime().then((loaded) =>
    issuedGeneration === accountGeneration
      ? loaded.enqueueSystemPromptDeletionRuntime(prompt.id, prompt.definitionRevision ?? 0)
      : 'discarded' as const,
  )
  void outcome.finally(() => {
    releaseSystemPromptMutation(lease)
    if (issuedGeneration !== accountGeneration) return
    heldSnapshots.delete(prompt.id)
    statusStore.refresh()
  })
  return outcome
}

export const retrySystemPromptDeletion = (): void => { runtime?.retrySystemPromptDeletionRuntime() }
export const discardSystemPromptDeletion = (): void => { runtime?.discardSystemPromptDeletionRuntime() }
export const useSystemPromptDeletionStatus = statusStore.useStatus
