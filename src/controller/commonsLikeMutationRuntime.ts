/** Lazy acknowledgement FIFO behind Commons endorsement. */
import { AccountSwitchedError, ApiRequestError } from '../api'
import {
  applyCommonsLike,
  commonsLikeResourceId,
  reconcileCommonsLike,
  type CommonsLikeIntent,
} from '../api/commonsLikeCommands.ts'
import { createAcknowledgedActionMutationController } from './acknowledgedActionMutationCore.ts'
import { publishCommonsLikeStatus } from './commonsLikeMutations.ts'
import type { RevisionedMutationFailure } from './revisionedMutationCore.ts'

function describeFailure(error: unknown): RevisionedMutationFailure {
  if (error instanceof AccountSwitchedError) {
    return { message: 'That Like choice belonged to the previous account. Dismiss it to continue.', retryable: false }
  }
  if (error instanceof ApiRequestError) {
    if ([400, 404, 409].includes(error.status)) {
      return { message: 'That Commons item is no longer available. Dismiss this choice and review the latest feed.', retryable: false }
    }
    if ([401, 403].includes(error.status)) {
      return { message: 'You no longer have permission to change that Like. Dismiss it to continue.', retryable: false }
    }
    if (error.status === 429) {
      return { message: 'Like changes are temporarily rate-limited. Retry shortly.', retryable: true }
    }
  }
  return { message: 'Couldn’t confirm your Like choice. Retry safely or Dismiss.', retryable: true }
}

const controller = createAcknowledgedActionMutationController<CommonsLikeIntent, undefined>({
  resourceId: (intent) => commonsLikeResourceId(intent.itemId),
  snapshot: () => undefined,
  mutate: applyCommonsLike,
  reconcile: (intent) => reconcileCommonsLike(intent),
  describeFailure,
  setStatus: publishCommonsLikeStatus,
  mintIdempotencyKey: (intent) => intent.intentId,
})

export const enqueueCommonsLikeRuntime = controller.enqueue
export const retryCommonsLikeRuntime = controller.retry
export const discardCommonsLikeRuntime = controller.discard
export const clearCommonsLikes = controller.clearAll
