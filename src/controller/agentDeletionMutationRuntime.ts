/** Lazy transport and destructive FIFO behind Agent removal. */
import type { Agent } from '../../contract/index.ts'
import {
  AccountSwitchedError,
  ApiRequestError,
  deleteAgent,
  reconcileAgentConfiguration,
} from '../api'
import { createRevisionedDeletionMutationController } from './revisionedDeletionCore.ts'
import { publishAgentDeletionStatus } from './agentDeletionMutations.ts'
import type { RevisionedMutationFailure } from './revisionedMutationCore.ts'

function describeFailure(error: unknown): RevisionedMutationFailure & { rebaseOnRetry: boolean } {
  if (error instanceof AccountSwitchedError) {
    return {
      message: 'That Agent removal belonged to the previous account. Dismiss it to continue.',
      retryable: false,
      rebaseOnRetry: false,
    }
  }
  if (error instanceof ApiRequestError) {
    if (error.status === 409 && /commission/i.test(error.message)) {
      return {
        message: 'This Agent is still a Contributor. Remove its Project assignments, then Retry removal.',
        retryable: true,
        rebaseOnRetry: false,
      }
    }
    if (error.status === 409 && /default agent/i.test(error.message)) {
      return {
        message: 'The default Agent cannot be removed. Dismiss this removal to continue.',
        retryable: false,
        rebaseOnRetry: false,
      }
    }
    if (error.status === 409) {
      return {
        message: 'This Agent changed elsewhere. The latest definition is loaded—review it, then retry removal or dismiss.',
        retryable: true,
        rebaseOnRetry: true,
      }
    }
    if ([400, 404].includes(error.status)) {
      return {
        message: 'That Agent is no longer available. Dismiss the removal to continue.',
        retryable: false,
        rebaseOnRetry: false,
      }
    }
    if ([401, 403].includes(error.status)) {
      return {
        message: 'You no longer have permission to remove that Agent. Dismiss it to continue.',
        retryable: false,
        rebaseOnRetry: false,
      }
    }
    if (error.status === 429) {
      return {
        message: 'Too many Agent changes at once. Retry removal in a moment.',
        retryable: true,
        rebaseOnRetry: false,
      }
    }
  }
  return {
    message: 'Couldn’t confirm removal. The Agent remains visible—Retry when the connection recovers or Dismiss.',
    retryable: true,
    rebaseOnRetry: false,
  }
}

const controller = createRevisionedDeletionMutationController<Agent>({
  reconcile: async (agentId) => (await reconcileAgentConfiguration(agentId)) ?? null,
  mutate: deleteAgent,
  revision: (agent) => agent.revision ?? 0,
  describeFailure,
  setStatus: publishAgentDeletionStatus,
  mintIdempotencyKey: () => crypto.randomUUID(),
})

export const enqueueAgentDeletionRuntime = controller.enqueue
export const retryAgentDeletionRuntime = controller.retry
export const discardAgentDeletionRuntime = controller.discard
export const clearAgentDeletions = controller.clearAll
