/** Lazy transport and acknowledgement FIFO behind Agent definition forking. */
import { AccountSwitchedError, ApiRequestError } from '../api'
import {
  applyAgentFork,
  reconcileAgentFork,
  type AgentForkIntent,
} from '../api/agentForkCommands.ts'
import { createAcknowledgedActionMutationController } from './acknowledgedActionMutationCore.ts'
import { publishAgentForkStatus } from './agentForkMutations.ts'
import type { RevisionedMutationFailure } from './revisionedMutationCore.ts'

function describeFailure(error: unknown): RevisionedMutationFailure {
  if (error instanceof AccountSwitchedError) {
    return { message: 'That definition belonged to the previous account. Dismiss it to continue.', retryable: false }
  }
  if (error instanceof ApiRequestError) {
    if (error.status === 400 || error.status === 404) {
      return { message: 'That definition can no longer be forked. Dismiss this attempt and review the Agent.', retryable: false }
    }
    if (error.status === 401 || error.status === 403) {
      return { message: 'You no longer have permission to fork that definition. Dismiss it to continue.', retryable: false }
    }
    if (error.status === 429) {
      return { message: 'Agent forking is temporarily rate-limited. Retry shortly.', retryable: true }
    }
  }
  return {
    message: 'Couldn’t confirm whether the Agent was forked. Retry safely or Dismiss.',
    retryable: true,
  }
}

const controller = createAcknowledgedActionMutationController<AgentForkIntent, undefined>({
  resourceId: (intent) => intent.sourceAgentId,
  snapshot: () => undefined,
  mutate: applyAgentFork,
  reconcile: reconcileAgentFork,
  describeFailure,
  setStatus: publishAgentForkStatus,
  mintIdempotencyKey: (intent) => intent.intentId,
})

export const enqueueAgentForkRuntime = controller.enqueue
export const retryAgentForkRuntime = controller.retry
export const discardAgentForkRuntime = controller.discard
export const clearAgentForks = controller.clearAll
