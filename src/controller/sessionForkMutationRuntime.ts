/** Lazy transport and acknowledgement FIFO behind conversation branching. */
import { AccountSwitchedError, ApiRequestError } from '../api'
import {
  applySessionFork,
  reconcileSessionFork,
  type SessionForkIntent,
} from '../api/sessionForkCommands.ts'
import { createAcknowledgedActionMutationController } from './acknowledgedActionMutationCore.ts'
import { publishSessionForkStatus } from './sessionForkMutations.ts'
import type { RevisionedMutationFailure } from './revisionedMutationCore.ts'

function describeFailure(error: unknown): RevisionedMutationFailure {
  if (error instanceof AccountSwitchedError) {
    return { message: 'That conversation belonged to the previous account. Dismiss it to continue.', retryable: false }
  }
  if (error instanceof ApiRequestError) {
    if (error.status === 400 || error.status === 404) {
      return { message: 'That turn can no longer be continued. Dismiss this attempt and review the conversation.', retryable: false }
    }
    if (error.status === 401 || error.status === 403) {
      return { message: 'You no longer have permission to continue that conversation. Dismiss it to continue.', retryable: false }
    }
    if (error.status === 429) {
      return { message: 'Conversation branching is temporarily rate-limited. Retry shortly.', retryable: true }
    }
  }
  return {
    message: 'Couldn’t confirm whether the conversation branch was created. Retry safely or Dismiss.',
    retryable: true,
  }
}

const controller = createAcknowledgedActionMutationController<SessionForkIntent, undefined>({
  resourceId: (intent) => `${intent.sourceSessionId}\0${intent.atMessageId}`,
  snapshot: () => undefined,
  mutate: applySessionFork,
  reconcile: reconcileSessionFork,
  describeFailure,
  setStatus: publishSessionForkStatus,
  mintIdempotencyKey: (intent) => intent.intentId,
})

export const enqueueSessionForkRuntime = controller.enqueue
export const retrySessionForkRuntime = controller.retry
export const discardSessionForkRuntime = controller.discard
export const clearSessionForks = controller.clearAll
