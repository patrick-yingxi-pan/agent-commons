/** Tiny eager facade for acknowledgement-owned system-prompt creation. */
import type { CreateSystemPromptRequest } from '../../contract/index.ts'
import { onAccountSwitch } from '../api'
import type { SystemPromptCreationIntent } from '../api/systemPromptCreationRevision.ts'
import {
  IDLE_REVISIONED_MUTATION,
  type RevisionedMutationOutcome,
} from './revisionedMutationCore.ts'
import { createMutationStatusStore } from './mutationStatusStore.ts'

const statusStore = createMutationStatusStore()
let accountGeneration = 0
let heldCount = 0
export const publishSystemPromptCreationStatus = statusStore.publish

type Runtime = typeof import('./systemPromptCreationMutationRuntime.ts')
let runtime: Runtime | null = null
let runtimePromise: Promise<Runtime> | null = null
const loadRuntime = (): Promise<Runtime> => {
  runtimePromise ??= import('./systemPromptCreationMutationRuntime.ts').then((loaded) => {
    runtime = loaded
    return loaded
  })
  return runtimePromise
}

onAccountSwitch(() => {
  accountGeneration += 1
  heldCount = 0
  if (runtime) runtime.clearSystemPromptCreations()
  else statusStore.publish(IDLE_REVISIONED_MUTATION)
})

export const isSystemPromptCreationHeld = (): boolean => heldCount > 0

export function enqueueSystemPromptCreation(input: {
  tenantId: string
  request: CreateSystemPromptRequest
}): Promise<RevisionedMutationOutcome> {
  const issuedGeneration = accountGeneration
  const intent: SystemPromptCreationIntent = { ...input, intentId: crypto.randomUUID() }
  heldCount += 1
  statusStore.refresh()
  const outcome = loadRuntime().then((loaded) =>
    issuedGeneration === accountGeneration
      ? loaded.enqueueSystemPromptCreationRuntime(intent)
      : 'discarded' as const,
  )
  void outcome.finally(() => {
    if (issuedGeneration !== accountGeneration) return
    heldCount = Math.max(0, heldCount - 1)
    statusStore.refresh()
  })
  return outcome
}

export const retrySystemPromptCreation = (): void => { runtime?.retrySystemPromptCreationRuntime() }
export const discardSystemPromptCreation = (): void => { runtime?.discardSystemPromptCreationRuntime() }
export const useSystemPromptCreationStatus = statusStore.useStatus
