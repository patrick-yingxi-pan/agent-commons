/** Eager held-form facade for acknowledgement-owned Agent proposal creation. */
import type { ProposeAgentChangeRequest } from '../../contract/index.ts'
import { onAccountSwitch } from '../api'
import type { AgentProposalCreationIntent } from '../api/agentProposalCreationRevision.ts'
import { createMutationStatusStore } from './mutationStatusStore.ts'
import {
  IDLE_REVISIONED_MUTATION,
  type RevisionedMutationOutcome,
} from './revisionedMutationCore.ts'

const statusStore = createMutationStatusStore()
const heldIntents = new Map<string, AgentProposalCreationIntent>()
let accountGeneration = 0
export const publishAgentProposalCreationStatus = statusStore.publish

type Runtime = typeof import('./agentProposalCreationMutationRuntime.ts')
let runtime: Runtime | null = null
let runtimePromise: Promise<Runtime> | null = null
const loadRuntime = (): Promise<Runtime> => {
  runtimePromise ??= import('./agentProposalCreationMutationRuntime.ts').then((loaded) => {
    runtime = loaded
    return loaded
  })
  return runtimePromise
}

onAccountSwitch(() => {
  accountGeneration += 1
  heldIntents.clear()
  if (runtime) runtime.clearAgentProposalCreations()
  else statusStore.publish(IDLE_REVISIONED_MUTATION)
})

export const heldAgentProposalCreation = (
  agentId: string,
): AgentProposalCreationIntent | undefined => heldIntents.get(agentId)

export const isAgentProposalCreationHeld = (agentId: string): boolean =>
  heldIntents.has(agentId)

export function enqueueAgentProposalCreation(input: {
  tenantId: string
  agentId: string
  request: ProposeAgentChangeRequest
}): Promise<RevisionedMutationOutcome> {
  if (heldIntents.has(input.agentId)) return Promise.resolve('discarded')
  const issuedGeneration = accountGeneration
  const intent: AgentProposalCreationIntent = { ...input, intentId: crypto.randomUUID() }
  heldIntents.set(input.agentId, intent)
  statusStore.refresh()
  const outcome = loadRuntime().then((loaded) =>
    issuedGeneration === accountGeneration
      ? loaded.enqueueAgentProposalCreationRuntime(intent)
      : 'discarded' as const,
  )
  void outcome.finally(() => {
    if (issuedGeneration !== accountGeneration) return
    heldIntents.delete(input.agentId)
    statusStore.refresh()
  })
  return outcome
}

export const retryAgentProposalCreation = (): void => { runtime?.retryAgentProposalCreationRuntime() }
export const discardAgentProposalCreation = (): void => { runtime?.discardAgentProposalCreationRuntime() }
export const useAgentProposalCreationStatus = statusStore.useStatus
