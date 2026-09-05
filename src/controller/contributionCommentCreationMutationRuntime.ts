/** Lazy transport and acknowledgement FIFO behind Contribution comments. */
import { AccountSwitchedError, ApiRequestError } from '../api'
import {
  applyContributionCommentCreation,
  reconcileContributionCommentCreation,
  type ContributionCommentCreationIntent,
} from '../api/contributionCommentCreationCommands.ts'
import { createAcknowledgedActionMutationController } from './acknowledgedActionMutationCore.ts'
import { publishContributionCommentCreationStatus } from './contributionCommentCreationMutations.ts'
import type { RevisionedMutationFailure } from './revisionedMutationCore.ts'

function describeFailure(error: unknown): RevisionedMutationFailure {
  if (error instanceof AccountSwitchedError) {
    return { message: 'That comment belonged to the previous account. Dismiss it to continue.', retryable: false }
  }
  if (error instanceof ApiRequestError) {
    if (error.status === 400 || error.status === 404) {
      return { message: 'This exact comment can no longer be posted here. Dismiss it and review the Contribution.', retryable: false }
    }
    if (error.status === 401 || error.status === 403) {
      return { message: 'You no longer have permission to comment here. Dismiss it to continue.', retryable: false }
    }
    if (error.status === 409) {
      return { message: 'This Contribution discussion is full. Dismiss this draft.', retryable: false }
    }
    if (error.status === 429) {
      return { message: 'Commenting is temporarily rate-limited. Retry shortly.', retryable: true }
    }
  }
  return {
    message: 'Couldn’t confirm whether this Contribution comment was posted. Retry safely or Dismiss.',
    retryable: true,
  }
}

const controller = createAcknowledgedActionMutationController<ContributionCommentCreationIntent, undefined>({
  resourceId: (intent) => intent.contributionId,
  snapshot: () => undefined,
  mutate: applyContributionCommentCreation,
  reconcile: reconcileContributionCommentCreation,
  describeFailure,
  setStatus: publishContributionCommentCreationStatus,
  mintIdempotencyKey: (intent) => intent.intentId,
})

export const enqueueContributionCommentCreationRuntime = controller.enqueue
export const retryContributionCommentCreationRuntime = controller.retry
export const discardContributionCommentCreationRuntime = controller.discard
export const clearContributionCommentCreations = controller.clearAll
