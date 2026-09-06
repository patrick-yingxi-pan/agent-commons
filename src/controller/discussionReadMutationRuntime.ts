/** Lazy acknowledgement FIFO behind viewer-private DM read cursors. */
import { AccountSwitchedError, ApiRequestError } from '../api'
import {
  applyDiscussionRead,
  discussionReadResourceId,
  reconcileDiscussionRead,
  type DiscussionReadIntent,
} from '../api/discussionReadCommands.ts'
import { createAcknowledgedActionMutationController } from './acknowledgedActionMutationCore.ts'
import { publishDiscussionReadStatus } from './discussionReadMutations.ts'
import type { RevisionedMutationFailure } from './revisionedMutationCore.ts'

function describeFailure(error: unknown): RevisionedMutationFailure {
  if (error instanceof AccountSwitchedError) {
    return { message: 'That read position belonged to the previous account. Dismiss it to continue.', retryable: false }
  }
  if (error instanceof ApiRequestError) {
    if ([400, 404, 409].includes(error.status)) {
      return { message: 'That message is no longer available. Dismiss this read update and review the latest conversation.', retryable: false }
    }
    if ([401, 403].includes(error.status)) {
      return { message: 'You no longer have permission to update that conversation. Dismiss this read update to continue.', retryable: false }
    }
    if (error.status === 429) {
      return { message: 'Read-position updates are temporarily rate-limited. Retry shortly.', retryable: true }
    }
  }
  return { message: 'Couldn’t confirm your read position. Retry safely or Dismiss.', retryable: true }
}

const controller = createAcknowledgedActionMutationController<DiscussionReadIntent, undefined>({
  resourceId: (intent) => discussionReadResourceId(intent.discussionId, intent.throughPostId),
  snapshot: () => undefined,
  mutate: applyDiscussionRead,
  reconcile: (intent) => reconcileDiscussionRead(intent),
  describeFailure,
  setStatus: publishDiscussionReadStatus,
  mintIdempotencyKey: (intent) => intent.intentId,
})

export const enqueueDiscussionReadRuntime = controller.enqueue
export const retryDiscussionReadRuntime = controller.retry
export const discardDiscussionReadRuntime = controller.discard
export const clearDiscussionReads = controller.clearAll
