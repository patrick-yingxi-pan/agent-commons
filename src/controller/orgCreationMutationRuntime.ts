/** Lazy transport and acknowledgement FIFO behind organization founding. */
import { AccountSwitchedError, ApiRequestError } from '../api'
import {
  applyOrgCreation,
  reconcileOrgCreation,
} from '../api/orgCreationCommands.ts'
import {
  orgCreationResourceId,
  type OrgCreationIntent,
} from '../api/orgCreationRevision.ts'
import { createAcknowledgedActionMutationController } from './acknowledgedActionMutationCore.ts'
import { publishOrgCreationStatus } from './orgCreationMutations.ts'
import type { RevisionedMutationFailure } from './revisionedMutationCore.ts'

function describeFailure(error: unknown): RevisionedMutationFailure {
  if (error instanceof AccountSwitchedError) {
    return { message: 'That organization belonged to the previous account. Dismiss it to continue.', retryable: false }
  }
  if (error instanceof ApiRequestError) {
    if ([400, 404, 409].includes(error.status)) {
      return { message: error.message, retryable: false }
    }
    if ([401, 403].includes(error.status)) {
      return { message: 'You no longer have permission to create this organization. Dismiss it to continue.', retryable: false }
    }
    if (error.status === 429) {
      return { message: 'Organization creation is temporarily rate-limited. Retry shortly.', retryable: true }
    }
  }
  return {
    message: 'Couldn’t confirm whether the organization was created. Its name is still held—Retry safely or Dismiss.',
    retryable: true,
  }
}

const controller = createAcknowledgedActionMutationController<OrgCreationIntent, undefined>({
  resourceId: orgCreationResourceId,
  snapshot: () => undefined,
  mutate: applyOrgCreation,
  reconcile: (intent, _baseline, idempotencyKey) => reconcileOrgCreation(intent, idempotencyKey),
  describeFailure,
  setStatus: publishOrgCreationStatus,
  mintIdempotencyKey: (intent) => intent.intentId,
})

export const enqueueOrgCreationRuntime = controller.enqueue
export const retryOrgCreationRuntime = controller.retry
export const discardOrgCreationRuntime = controller.discard
export const clearOrgCreations = controller.clearAll
