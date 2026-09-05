/** Lazy transport and acknowledgement FIFO behind Agent proposal creation. */
import { AccountSwitchedError, ApiRequestError } from '../api'
import {
  applyAgentProposalCreation,
  reconcileAgentProposalCreation,
} from '../api/agentProposalCreationCommands.ts'
import {
  agentProposalCreationResourceId,
  type AgentProposalCreationIntent,
} from '../api/agentProposalCreationRevision.ts'
import { createAcknowledgedActionMutationController } from './acknowledgedActionMutationCore.ts'
import { publishAgentProposalCreationStatus } from './agentProposalCreationMutations.ts'
import type { RevisionedMutationFailure } from './revisionedMutationCore.ts'

function describeFailure(error: unknown): RevisionedMutationFailure {
  if (error instanceof AccountSwitchedError) {
    return { message: 'That Agent proposal belonged to the previous account. Dismiss it to continue.', retryable: false }
  }
  if (error instanceof ApiRequestError) {
    if (error.status === 400 || error.status === 409) {
      return { message: error.message, retryable: false }
    }
    if ([401, 403, 404].includes(error.status)) {
      return { message: 'You can no longer propose a change to that Agent. Dismiss it to continue.', retryable: false }
    }
    if (error.status === 429) {
      return { message: 'Agent proposals are temporarily rate-limited. Retry shortly.', retryable: true }
    }
  }
  return {
    message: 'Couldn’t confirm whether the Agent proposal opened. Its review queue was checked—Retry safely or Dismiss.',
    retryable: true,
  }
}

const controller = createAcknowledgedActionMutationController<AgentProposalCreationIntent, undefined>({
  resourceId: agentProposalCreationResourceId,
  snapshot: () => undefined,
  mutate: applyAgentProposalCreation,
  reconcile: (intent, _baseline, idempotencyKey) =>
    reconcileAgentProposalCreation(intent, idempotencyKey),
  describeFailure,
  setStatus: publishAgentProposalCreationStatus,
  mintIdempotencyKey: (intent) => intent.intentId,
})

export const enqueueAgentProposalCreationRuntime = controller.enqueue
export const retryAgentProposalCreationRuntime = controller.retry
export const discardAgentProposalCreationRuntime = controller.discard
export const clearAgentProposalCreations = controller.clearAll
