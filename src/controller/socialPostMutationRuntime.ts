/** Lazy transport and acknowledgement FIFO behind authored social prose. */
import { AccountSwitchedError, ApiRequestError } from '../api'
import {
  applySocialPostMutation,
  clearSocialPostResults,
  reconcileSocialPostMutation,
  takeSocialPostResult,
} from '../api/socialPostCommands.ts'
import {
  socialPostResourceId,
  type SocialPostMutationIntent,
} from '../api/socialPostRevision.ts'
import { createAcknowledgedActionMutationController } from './acknowledgedActionMutationCore.ts'
import { publishSocialPostMutationStatus, type SocialPostMutationResult } from './socialPostMutations.ts'
import type { RevisionedMutationFailure } from './revisionedMutationCore.ts'

function describeFailure(error: unknown): RevisionedMutationFailure {
  if (error instanceof AccountSwitchedError) {
    return { message: 'That post belonged to the previous account. Dismiss it to continue.', retryable: false }
  }
  if (error instanceof ApiRequestError) {
    if (error.status === 400 || error.status === 404 || error.status === 409) {
      return { message: 'That post can no longer be applied here. Dismiss it and review the thread.', retryable: false }
    }
    if (error.status === 401 || error.status === 403) {
      return { message: 'You no longer have permission to post here. Dismiss it to continue.', retryable: false }
    }
    if (error.status === 429) {
      return { message: 'Posting is temporarily rate-limited. Retry shortly.', retryable: true }
    }
  }
  return {
    message: 'Couldn’t confirm the post. The thread was refreshed—Retry safely or Dismiss.',
    retryable: true,
  }
}

const controller = createAcknowledgedActionMutationController<SocialPostMutationIntent, undefined>({
  resourceId: socialPostResourceId,
  snapshot: () => undefined,
  mutate: applySocialPostMutation,
  reconcile: reconcileSocialPostMutation,
  describeFailure,
  setStatus: publishSocialPostMutationStatus,
  mintIdempotencyKey: (intent) => intent.logicalKey,
})

export async function enqueueSocialPostMutationRuntime(
  intent: SocialPostMutationIntent,
): Promise<SocialPostMutationResult> {
  const outcome = await controller.enqueue(intent)
  const discussion = outcome === 'applied' ? takeSocialPostResult(intent.logicalKey) : undefined
  return { outcome, ...(discussion ? { discussion } : {}) }
}

export const retrySocialPostMutationRuntime = controller.retry
export const discardSocialPostMutationRuntime = controller.discard
export function clearSocialPostMutations(): void {
  controller.clearAll()
  clearSocialPostResults()
}
