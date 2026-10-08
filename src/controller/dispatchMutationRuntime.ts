/** Lazy transport and acknowledgement FIFO behind Dispatch creation. */
import { AccountSwitchedError, ApiRequestError } from '../api'
import {
  createDispatch,
  dispatchBaseline,
  reconcileDispatch,
  type DispatchBaseline,
  type DispatchIntent,
} from '../api/dispatchCommands'
import { createAcknowledgedActionMutationController } from './acknowledgedActionMutationCore'
import { publishDispatchMutationStatus } from './dispatchMutations'
import type { RevisionedMutationFailure } from './revisionedMutationCore'

function describeFailure(error: unknown): RevisionedMutationFailure {
  if (error instanceof AccountSwitchedError) {
    return { message: 'That dispatch belonged to the previous account. Dismiss it to continue.', retryable: false }
  }
  if (error instanceof ApiRequestError) {
    if (error.status === 400 || error.status === 404 || error.status === 409) {
      return { message: 'That dispatch cannot start. Dismiss it and review the task, Agent, and model connection.', retryable: false }
    }
    if (error.status === 401 || error.status === 403) {
      return { message: 'You no longer have permission to dispatch this task. Dismiss it to continue.', retryable: false }
    }
    if (error.status === 429) {
      return { message: 'Dispatch cannot start yet. Check the account budget or retry after another run finishes.', retryable: true }
    }
  }
  return {
    message: 'Couldn’t confirm whether the dispatch started. The feed was refreshed—Retry safely or Dismiss.',
    retryable: true,
  }
}

const controller = createAcknowledgedActionMutationController<DispatchIntent, DispatchBaseline>({
  resourceId: (intent) => intent.intentId,
  snapshot: dispatchBaseline,
  mutate: createDispatch,
  reconcile: reconcileDispatch,
  describeFailure,
  setStatus: publishDispatchMutationStatus,
  mintIdempotencyKey: () => crypto.randomUUID(),
})

export const enqueueDispatchMutationRuntime = controller.enqueue
export const retryDispatchMutationRuntime = controller.retry
export const discardDispatchMutationRuntime = controller.discard
export const clearDispatchMutations = controller.clearAll
