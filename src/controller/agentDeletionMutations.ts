/** Eager held-state facade for acknowledgement-owned Agent removal. */
import type { Agent } from '../../contract/index.ts'
import { onAccountSwitch } from '../api'
import { createMutationStatusStore } from './mutationStatusStore.ts'
import {
  IDLE_REVISIONED_MUTATION,
  type RevisionedMutationOutcome,
} from './revisionedMutationCore.ts'
import {
  acquireAgentMutation,
  isAgentDeletionHeld,
  releaseAgentMutation,
} from './agentMutationHolds.ts'

export const AGENT_DELETE_SCOPE =
  'This permanently removes the Agent, its proposal history, and its Project delegations. Existing conversations, prior replies, and contributions stay. New replies require choosing an available Agent in Model and effort → Conversation Agent. Remove its Contributor assignments first.'

const statusStore = createMutationStatusStore()
const heldSnapshots = new Map<string, Agent>()
let accountGeneration = 0
export const publishAgentDeletionStatus = statusStore.publish

type Runtime = typeof import('./agentDeletionMutationRuntime.ts')
let runtime: Runtime | null = null
let runtimePromise: Promise<Runtime> | null = null
const loadRuntime = (): Promise<Runtime> => {
  runtimePromise ??= import('./agentDeletionMutationRuntime.ts').then((loaded) => {
    runtime = loaded
    return loaded
  })
  return runtimePromise
}

onAccountSwitch(() => {
  accountGeneration += 1
  heldSnapshots.clear()
  if (runtime) runtime.clearAgentDeletions()
  else statusStore.publish(IDLE_REVISIONED_MUTATION)
})

export { isAgentDeletionHeld }

/** Preserve a pending Agent row if an early registry event observes committed
 * absence before the originating response or exact reconciliation settles. */
export const heldAgentDeletions = (): Agent[] => [...heldSnapshots.values()]

export function enqueueAgentDeletion(agent: Agent): Promise<RevisionedMutationOutcome> {
  const lease = acquireAgentMutation('deletion', agent.id)
  if (!lease) return Promise.resolve('discarded')
  const issuedGeneration = accountGeneration
  heldSnapshots.set(agent.id, agent)
  statusStore.refresh()
  const outcome = loadRuntime().then((loaded) =>
    issuedGeneration === accountGeneration
      ? loaded.enqueueAgentDeletionRuntime(agent.id, agent.revision ?? 0)
      : 'discarded' as const,
  )
  void outcome.finally(() => {
    releaseAgentMutation(lease)
    if (issuedGeneration !== accountGeneration) return
    heldSnapshots.delete(agent.id)
    statusStore.refresh()
  })
  return outcome
}

export const retryAgentDeletion = (): void => { runtime?.retryAgentDeletionRuntime() }
export const discardAgentDeletion = (): void => { runtime?.discardAgentDeletionRuntime() }
export const useAgentDeletionStatus = statusStore.useStatus
