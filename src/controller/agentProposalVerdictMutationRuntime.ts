/** Lazy acknowledgement controller behind owner Agent proposal verdicts. */
import { AccountSwitchedError, ApiRequestError } from '../api'
import {
  applyAgentProposalVerdict,
  reconcileAgentProposalVerdict,
  type AgentProposalVerdictIntent,
} from '../api/agentProposalVerdictCommands.ts'
import { createAcknowledgedActionMutationController } from './acknowledgedActionMutationCore.ts'
import { publishAgentProposalVerdictStatus } from './agentProposalVerdictMutations.ts'
import type { RevisionedMutationFailure } from './revisionedMutationCore.ts'

function describeFailure(error: unknown): RevisionedMutationFailure {
  if (error instanceof AccountSwitchedError) {
    return { message: 'That Agent proposal decision belonged to the previous account. Dismiss it to continue.', retryable: false }
  }
  if (error instanceof ApiRequestError) {
    if (error.status === 400 || error.status === 404) {
      return { message: 'This exact Agent proposal decision can no longer be applied. Dismiss it and review the proposal.', retryable: false }
    }
    if (error.status === 401 || error.status === 403) {
      return { message: 'You no longer have permission to decide this proposal. Dismiss it to continue.', retryable: false }
    }
    if (error.status === 409) {
      return { message: 'This proposal was decided elsewhere. Dismiss this action and review the current decision.', retryable: false }
    }
    if (error.status === 429) {
      return { message: 'Proposal decisions are temporarily rate-limited. Retry shortly.', retryable: true }
    }
  }
  return {
    message: 'Couldn’t confirm whether this Agent proposal decision was applied. Retry safely or Dismiss.',
    retryable: true,
  }
}

const controller = createAcknowledgedActionMutationController<AgentProposalVerdictIntent, undefined>({
  resourceId: (intent) => `${intent.agentId}:${intent.proposalId}`,
  snapshot: () => undefined,
  mutate: applyAgentProposalVerdict,
  reconcile: reconcileAgentProposalVerdict,
  describeFailure,
  setStatus: publishAgentProposalVerdictStatus,
  mintIdempotencyKey: (intent) => intent.intentId,
})

export const enqueueAgentProposalVerdictRuntime = controller.enqueue
export const retryAgentProposalVerdictRuntime = controller.retry
export const discardAgentProposalVerdictRuntime = controller.discard
export const clearAgentProposalVerdicts = controller.clearAll
