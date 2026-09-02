/** Tiny eager facade for acknowledgement-owned Agent creation. */
import type { CreateAgentRequest } from '../../contract/index.ts'
import { onAccountSwitch } from '../api'
import type { AgentCreationIntent } from '../api/agentCreationRevision.ts'
import {
  IDLE_REVISIONED_MUTATION,
  type RevisionedMutationOutcome,
} from './revisionedMutationCore.ts'
import { createMutationStatusStore } from './mutationStatusStore.ts'

const statusStore = createMutationStatusStore()
let accountGeneration = 0
let heldCount = 0
export const publishAgentCreationStatus = statusStore.publish

type Runtime = typeof import('./agentCreationMutationRuntime.ts')
let runtime: Runtime | null = null
let runtimePromise: Promise<Runtime> | null = null
const loadRuntime = (): Promise<Runtime> => {
  runtimePromise ??= import('./agentCreationMutationRuntime.ts').then((loaded) => {
    runtime = loaded
    return loaded
  })
  return runtimePromise
}

onAccountSwitch(() => {
  accountGeneration += 1
  heldCount = 0
  if (runtime) runtime.clearAgentCreations()
  else statusStore.publish(IDLE_REVISIONED_MUTATION)
})

export const isAgentCreationHeld = (): boolean => heldCount > 0

export function enqueueAgentCreation(input: {
  tenantId: string
  request: CreateAgentRequest
}): Promise<RevisionedMutationOutcome> {
  const issuedGeneration = accountGeneration
  const intent: AgentCreationIntent = { ...input, intentId: crypto.randomUUID() }
  heldCount += 1
  statusStore.refresh()
  const outcome = loadRuntime().then((loaded) =>
    issuedGeneration === accountGeneration
      ? loaded.enqueueAgentCreationRuntime(intent)
      : 'discarded' as const,
  )
  void outcome.finally(() => {
    if (issuedGeneration !== accountGeneration) return
    heldCount = Math.max(0, heldCount - 1)
    statusStore.refresh()
  })
  return outcome
}

export const retryAgentCreation = (): void => { runtime?.retryAgentCreationRuntime() }
export const discardAgentCreation = (): void => { runtime?.discardAgentCreationRuntime() }
export const useAgentCreationStatus = statusStore.useStatus
