/** Lazy transport and acknowledgement FIFO behind reusable Context setup. */
import { AccountSwitchedError, ApiRequestError } from '../api'
import {
  applySavedContextCreation,
  reconcileSavedContextCreation,
  savedContextCreationResourceId,
  type SavedContextCreationIntent,
} from '../api/savedContextCreationCommands.ts'
import { createAcknowledgedActionMutationController } from './acknowledgedActionMutationCore.ts'
import { publishSavedContextCreationStatus } from './savedContextCreationMutations.ts'
import type { RevisionedMutationFailure } from './revisionedMutationCore.ts'

function describeFailure(error: unknown): RevisionedMutationFailure {
  if (error instanceof AccountSwitchedError) {
    return { message: 'That context setup belonged to the previous account. Dismiss it to continue.', retryable: false }
  }
  if (error instanceof ApiRequestError) {
    if ([400, 404, 409].includes(error.status)) {
      return { message: 'That context can no longer be added from this setup. Dismiss it and review the latest list.', retryable: false }
    }
    if ([401, 403].includes(error.status)) {
      return { message: 'You no longer have permission to add that context. Dismiss it to continue.', retryable: false }
    }
    if (error.status === 429) {
      return { message: 'Context setup is temporarily rate-limited. Retry shortly.', retryable: true }
    }
  }
  return {
    message: 'Couldn’t confirm whether the context was added. Retry safely or Dismiss.',
    retryable: true,
  }
}

const controller = createAcknowledgedActionMutationController<SavedContextCreationIntent, undefined>({
  resourceId: savedContextCreationResourceId,
  snapshot: () => undefined,
  mutate: applySavedContextCreation,
  reconcile: (intent) => reconcileSavedContextCreation(intent),
  describeFailure,
  setStatus: publishSavedContextCreationStatus,
  mintIdempotencyKey: (intent) => intent.intentId,
})

export const enqueueSavedContextCreationRuntime = controller.enqueue
export const retrySavedContextCreationRuntime = controller.retry
export const discardSavedContextCreationRuntime = controller.discard
export const clearSavedContextCreations = controller.clearAll
