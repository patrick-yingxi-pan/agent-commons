/** Lazy transport and acknowledgement FIFO behind delegated judgment. */
import { AccountSwitchedError, ApiRequestError } from '../api'
import {
  applyDelegatedJudgment,
  reconcileDelegatedJudgment,
  type DelegatedJudgmentIntent,
} from '../api/delegatedJudgmentCommands.ts'
import { createAcknowledgedActionMutationController } from './acknowledgedActionMutationCore.ts'
import { publishDelegatedJudgmentStatus } from './delegatedJudgmentMutations.ts'
import type { RevisionedMutationFailure } from './revisionedMutationCore.ts'

function describeFailure(error: unknown): RevisionedMutationFailure {
  if (error instanceof AccountSwitchedError) {
    return { message: 'That delegated judgment belonged to the previous account. Dismiss it to continue.', retryable: false }
  }
  if (error instanceof ApiRequestError) {
    if (error.status === 400 || error.status === 404) {
      return { message: 'This exact Delegation or Contribution is no longer available. Dismiss it and inspect current work.', retryable: false }
    }
    if (error.status === 401 || error.status === 403) {
      return { message: 'You no longer have permission to ask this delegate. Dismiss it to continue.', retryable: false }
    }
    if (error.status === 409) {
      return { message: 'The delegated act is no longer pending. Dismiss this request and inspect the current Contribution.', retryable: false }
    }
    if (error.status === 429) {
      return { message: 'Delegated judgment is temporarily rate-limited. Retry shortly.', retryable: true }
    }
  }
  return {
    message: 'Couldn’t confirm what the delegate decided. Retry safely or Dismiss.',
    retryable: true,
  }
}

const controller = createAcknowledgedActionMutationController<DelegatedJudgmentIntent, undefined>({
  resourceId: (intent) => intent.contributionId,
  snapshot: () => undefined,
  mutate: applyDelegatedJudgment,
  reconcile: reconcileDelegatedJudgment,
  describeFailure,
  setStatus: publishDelegatedJudgmentStatus,
  mintIdempotencyKey: (intent) => intent.intentId,
})

export const enqueueDelegatedJudgmentRuntime = controller.enqueue
export const retryDelegatedJudgmentRuntime = controller.retry
export const discardDelegatedJudgmentRuntime = controller.discard
export const clearDelegatedJudgments = controller.clearAll
