/** Lazy transport and acknowledgement FIFO behind Agent creation. */
import { AccountSwitchedError, ApiRequestError } from '../api'
import {
  applyAgentCreation,
  reconcileAgentCreation,
} from '../api/agentCreationCommands.ts'
import {
  agentCreationResourceId,
  type AgentCreationIntent,
} from '../api/agentCreationRevision.ts'
import { createAcknowledgedActionMutationController } from './acknowledgedActionMutationCore.ts'
import { publishAgentCreationStatus } from './agentCreationMutations.ts'
import type { RevisionedMutationFailure } from './revisionedMutationCore.ts'

function describeFailure(error: unknown): RevisionedMutationFailure {
  if (error instanceof AccountSwitchedError) {
    return { message: 'That Agent belonged to the previous account. Dismiss it to continue.', retryable: false }
  }
  if (error instanceof ApiRequestError) {
    if ([400, 404, 409].includes(error.status)) {
      return { message: error.message, retryable: false }
    }
    if ([401, 403].includes(error.status)) {
      return { message: 'You no longer have permission to create this Agent. Dismiss it to continue.', retryable: false }
    }
    if (error.status === 429) {
      return { message: 'Agent creation is temporarily rate-limited. Retry shortly.', retryable: true }
    }
  }
  return {
    message: 'Couldn’t confirm whether the Agent was created. Agents were refreshed—Retry safely or Dismiss.',
    retryable: true,
  }
}

const controller = createAcknowledgedActionMutationController<AgentCreationIntent, undefined>({
  resourceId: agentCreationResourceId,
  snapshot: () => undefined,
  mutate: applyAgentCreation,
  reconcile: (intent, _baseline, idempotencyKey) => reconcileAgentCreation(intent, idempotencyKey),
  describeFailure,
  setStatus: publishAgentCreationStatus,
  mintIdempotencyKey: (intent) => intent.intentId,
})

export const enqueueAgentCreationRuntime = controller.enqueue
export const retryAgentCreationRuntime = controller.retry
export const discardAgentCreationRuntime = controller.discard
export const clearAgentCreations = controller.clearAll
