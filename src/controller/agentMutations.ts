/** App wiring for conflict-safe Agent definition, binding, grant, and
 * publication edits. */
import type { Agent, AgentConfigurationPatch } from '../../contract/index.ts'
import {
  AccountSwitchedError,
  ApiRequestError,
  keys,
  onAccountSwitch,
  patchAgent,
  peek,
  reconcileAgentConfiguration,
} from '../api'
import {
  createRevisionedMutationController,
  type RevisionedMutationFailure,
  type RevisionedMutationOutcome,
} from './revisionedMutationCore'
import { createMutationStatusStore } from './mutationStatusStore.ts'
import {
  acquireAgentMutation,
  isAgentConfigurationHeld,
  releaseAgentMutation,
} from './agentMutationHolds.ts'

function describeFailure(error: unknown): RevisionedMutationFailure {
  if (error instanceof AccountSwitchedError) {
    return { message: 'That agent change belonged to the previous account. Dismiss it to continue.', retryable: false }
  }
  if (error instanceof ApiRequestError) {
    if (error.status === 409) {
      return {
        message: 'This agent changed elsewhere. The latest version is loaded behind your held edits—review it, then retry or dismiss.',
        retryable: true,
      }
    }
    if (error.status === 400 || error.status === 404) {
      return { message: 'That agent change is no longer valid. Dismiss it and review the latest version.', retryable: false }
    }
    if (error.status === 401 || error.status === 403) {
      return { message: 'You no longer have permission to change that agent. Dismiss it to continue.', retryable: false }
    }
    if (error.status === 429) {
      return { message: 'Too many agent changes at once. Retry in a moment.', retryable: true }
    }
  }
  return { message: 'Couldn’t confirm the agent change. Your edits are still here—retry when the connection recovers.', retryable: true }
}

const statusStore = createMutationStatusStore()

const cachedAgent = (agentId: string): Agent | undefined =>
  peek<Agent[]>(keys.workerAgents)?.find((agent) => agent.id === agentId)

const reconcile = async (agentId: string): Promise<Agent> => {
  const agent = await reconcileAgentConfiguration(agentId)
  if (!agent) throw new ApiRequestError('not_found', 'That agent no longer exists.', 404)
  return agent
}

const controller = createRevisionedMutationController<Agent, AgentConfigurationPatch>({
  snapshot: cachedAgent,
  reconcile,
  revision: (agent) => agent.revision ?? 0,
  mutate: patchAgent,
  describeFailure,
  setStatus: statusStore.publish,
  mintIdempotencyKey: () => crypto.randomUUID(),
})

onAccountSwitch(() => controller.clearAll())

export function updateAgent(
  agentId: string,
  patch: AgentConfigurationPatch,
): Promise<RevisionedMutationOutcome> {
  const lease = acquireAgentMutation('configuration', agentId)
  if (!lease) return Promise.resolve('discarded')
  statusStore.refresh()
  const outcome = controller.enqueue(agentId, patch)
  void outcome.finally(() => {
    releaseAgentMutation(lease)
    statusStore.refresh()
  })
  return outcome
}

export const retryAgentMutation = controller.retry
export const discardAgentMutation = controller.discard

export { isAgentConfigurationHeld as isAgentMutationHeld }
export const useAgentMutationStatus = statusStore.useStatus
