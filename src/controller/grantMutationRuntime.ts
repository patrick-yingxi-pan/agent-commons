/** Lazy transport and acknowledgement FIFO behind grant changes. */
import { AccountSwitchedError, ApiRequestError } from '../api'
import {
  applyGrantMutation,
  grantMutationBaseline,
  reconcileGrantMutation,
  type GrantMutationBaseline,
  type GrantMutationIntent,
} from '../api/grantMutationCommands.ts'
import { grantMutationSubject } from '../api/grantRevision.ts'
import { createAcknowledgedActionMutationController } from './acknowledgedActionMutationCore.ts'
import { publishGrantMutationStatus } from './grantMutations.ts'
import type { RevisionedMutationFailure } from './revisionedMutationCore.ts'

function describeFailure(error: unknown): RevisionedMutationFailure {
  if (error instanceof AccountSwitchedError) {
    return { message: 'That sharing change belonged to the previous account. Dismiss it to continue.', retryable: false }
  }
  if (error instanceof ApiRequestError) {
    if (error.status === 400 || error.status === 404 || error.status === 409) {
      return { message: 'That sharing change is no longer valid. Dismiss it and review the audience.', retryable: false }
    }
    if (error.status === 401 || error.status === 403) {
      return { message: 'You no longer have permission to change this audience. Dismiss it to continue.', retryable: false }
    }
    if (error.status === 429) {
      return { message: 'Sharing is temporarily rate-limited. Retry shortly.', retryable: true }
    }
  }
  return {
    message: 'Couldn’t confirm the sharing change. The audience was refreshed—Retry safely or Dismiss.',
    retryable: true,
  }
}

const controller = createAcknowledgedActionMutationController<GrantMutationIntent, GrantMutationBaseline>({
  resourceId: (intent) => {
    const subject = grantMutationSubject(intent)
    return `${subject.kind}:${subject.id}`
  },
  snapshot: grantMutationBaseline,
  mutate: applyGrantMutation,
  reconcile: reconcileGrantMutation,
  describeFailure,
  setStatus: publishGrantMutationStatus,
  mintIdempotencyKey: () => crypto.randomUUID(),
})

export const enqueueGrantMutationRuntime = controller.enqueue
export const retryGrantMutationRuntime = controller.retry
export const discardGrantMutationRuntime = controller.discard
export const clearGrantMutations = controller.clearAll
