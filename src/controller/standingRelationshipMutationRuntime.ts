/** Lazy acknowledgement FIFO behind Follow and Watch. */
import { AccountSwitchedError, ApiRequestError } from '../api'
import {
  applyStandingRelationship,
  reconcileStandingRelationship,
  standingRelationshipResourceId,
  type StandingRelationshipIntent,
} from '../api/standingRelationshipCommands.ts'
import { createAcknowledgedActionMutationController } from './acknowledgedActionMutationCore.ts'
import { publishStandingRelationshipStatus } from './standingRelationshipMutations.ts'
import type { RevisionedMutationFailure } from './revisionedMutationCore.ts'

function describeFailure(error: unknown): RevisionedMutationFailure {
  if (error instanceof AccountSwitchedError) {
    return { message: 'That Follow or Watch choice belonged to the previous account. Dismiss it to continue.', retryable: false }
  }
  if (error instanceof ApiRequestError) {
    if ([400, 404, 409].includes(error.status)) {
      return { message: 'That Follow or Watch choice is no longer available. Dismiss it and review the latest page.', retryable: false }
    }
    if ([401, 403].includes(error.status)) {
      return { message: 'You no longer have permission to change that Follow or Watch choice. Dismiss it to continue.', retryable: false }
    }
    if (error.status === 429) {
      return { message: 'Follow and Watch changes are temporarily rate-limited. Retry shortly.', retryable: true }
    }
  }
  return { message: 'Couldn’t confirm your Follow or Watch choice. Retry safely or Dismiss.', retryable: true }
}

const controller = createAcknowledgedActionMutationController<StandingRelationshipIntent, undefined>({
  resourceId: standingRelationshipResourceId,
  snapshot: () => undefined,
  mutate: applyStandingRelationship,
  reconcile: (intent) => reconcileStandingRelationship(intent),
  describeFailure,
  setStatus: publishStandingRelationshipStatus,
  mintIdempotencyKey: (intent) => intent.intentId,
})

export const enqueueStandingRelationshipRuntime = controller.enqueue
export const retryStandingRelationshipRuntime = controller.retry
export const discardStandingRelationshipRuntime = controller.discard
export const clearStandingRelationships = controller.clearAll
