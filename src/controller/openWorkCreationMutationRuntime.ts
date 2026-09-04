/** Lazy transport and acknowledgement FIFO behind open-work posting. */
import { AccountSwitchedError, ApiRequestError } from '../api'
import {
  applyOpenWorkCreation,
  reconcileOpenWorkCreation,
  type OpenWorkCreationIntent,
} from '../api/openWorkCreationCommands.ts'
import { createAcknowledgedActionMutationController } from './acknowledgedActionMutationCore.ts'
import { publishOpenWorkCreationStatus } from './openWorkCreationMutations.ts'
import type { RevisionedMutationFailure } from './revisionedMutationCore.ts'

function describeFailure(error: unknown): RevisionedMutationFailure {
  if (error instanceof AccountSwitchedError) {
    return { message: 'That work item belonged to the previous account. Dismiss it to continue.', retryable: false }
  }
  if (error instanceof ApiRequestError) {
    if (error.status === 400 || error.status === 404) {
      return { message: 'This work item can no longer be posted here. Dismiss it and review the Project.', retryable: false }
    }
    if (error.status === 401 || error.status === 403) {
      return { message: 'You no longer have permission to post work here. Dismiss it to continue.', retryable: false }
    }
    if (error.status === 409) {
      return { message: 'This backlog is full. Resolve or retract an open item, then Retry or Dismiss.', retryable: true }
    }
    if (error.status === 429) {
      return { message: 'Work-item posting is temporarily rate-limited. Retry shortly.', retryable: true }
    }
  }
  return {
    message: 'Couldn’t confirm whether this work item was posted. Retry safely or Dismiss.',
    retryable: true,
  }
}

const controller = createAcknowledgedActionMutationController<OpenWorkCreationIntent, undefined>({
  resourceId: (intent) => intent.projectId,
  snapshot: () => undefined,
  mutate: applyOpenWorkCreation,
  reconcile: reconcileOpenWorkCreation,
  describeFailure,
  setStatus: publishOpenWorkCreationStatus,
  mintIdempotencyKey: (intent) => intent.intentId,
})

export const enqueueOpenWorkCreationRuntime = controller.enqueue
export const retryOpenWorkCreationRuntime = controller.retry
export const discardOpenWorkCreationRuntime = controller.discard
export const clearOpenWorkCreations = controller.clearAll
