/** Lazy acknowledgement controller behind Agent proposal comments. */
import { AccountSwitchedError, ApiRequestError } from '../api'
import {
  applyAgentProposalCommentCreation,
  reconcileAgentProposalCommentCreation,
  type AgentProposalCommentCreationIntent,
} from '../api/agentProposalCommentCreationCommands.ts'
import { createAcknowledgedActionMutationController } from './acknowledgedActionMutationCore.ts'
import { publishAgentProposalCommentCreationStatus } from './agentProposalCommentCreationMutations.ts'
import type { RevisionedMutationFailure } from './revisionedMutationCore.ts'

function describeFailure(error: unknown): RevisionedMutationFailure {
  if (error instanceof AccountSwitchedError) {
    return { message: 'That Agent proposal comment belonged to the previous account. Dismiss it to continue.', retryable: false }
  }
  if (error instanceof ApiRequestError) {
    if (error.status === 400 || error.status === 404) {
      return { message: 'This exact comment can no longer be posted here. Dismiss it and review the proposal.', retryable: false }
    }
    if (error.status === 401 || error.status === 403) {
      return { message: 'You no longer have permission to comment here. Dismiss it to continue.', retryable: false }
    }
    if (error.status === 409) {
      return { message: 'This proposal is resolved or its discussion is full. Dismiss this draft.', retryable: false }
    }
    if (error.status === 429) {
      return { message: 'Commenting is temporarily rate-limited. Retry shortly.', retryable: true }
    }
  }
  return {
    message: 'Couldn’t confirm whether this Agent proposal comment was posted. Retry safely or Dismiss.',
    retryable: true,
  }
}

const controller = createAcknowledgedActionMutationController<AgentProposalCommentCreationIntent, undefined>({
  resourceId: (intent) => `${intent.agentId}:${intent.proposalId}`,
  snapshot: () => undefined,
  mutate: applyAgentProposalCommentCreation,
  reconcile: reconcileAgentProposalCommentCreation,
  describeFailure,
  setStatus: publishAgentProposalCommentCreationStatus,
  mintIdempotencyKey: (intent) => intent.intentId,
})

export const enqueueAgentProposalCommentCreationRuntime = controller.enqueue
export const retryAgentProposalCommentCreationRuntime = controller.retry
export const discardAgentProposalCommentCreationRuntime = controller.discard
export const clearAgentProposalCommentCreations = controller.clearAll
