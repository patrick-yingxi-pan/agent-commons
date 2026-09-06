/** Lazy acknowledgement FIFO behind maintainer security actions. */
import { AccountSwitchedError, ApiRequestError } from '../api'
import {
  adminActionResourceId,
  applyAdminAction,
  reconcileAdminAction,
  type AdminActionIntent,
} from '../api/adminActionCommands.ts'
import { createAcknowledgedActionMutationController } from './acknowledgedActionMutationCore.ts'
import { publishAdminActionStatus } from './adminActionMutations.ts'
import type { RevisionedMutationFailure } from './revisionedMutationCore.ts'

function describeFailure(error: unknown): RevisionedMutationFailure {
  if (error instanceof AccountSwitchedError) {
    return { message: 'That maintainer action belonged to the previous account. Dismiss it to continue.', retryable: false }
  }
  if (error instanceof ApiRequestError) {
    if (error.status === 409) {
      return { message: 'That row reached a different terminal state. Dismiss this action and review the refreshed console.', retryable: false }
    }
    if ([400, 404].includes(error.status)) {
      return { message: 'That maintainer action is no longer available. Dismiss it and review the refreshed console.', retryable: false }
    }
    if ([401, 403].includes(error.status)) {
      return { message: 'Your maintainer access is no longer active. Dismiss this action to continue.', retryable: false }
    }
    if (error.status === 429) {
      return { message: 'Maintainer actions are temporarily rate-limited. Retry shortly.', retryable: true }
    }
  }
  return { message: 'Couldn’t confirm that maintainer action. Retry safely or Dismiss.', retryable: true }
}

const controller = createAcknowledgedActionMutationController<AdminActionIntent, undefined>({
  resourceId: adminActionResourceId,
  snapshot: () => undefined,
  mutate: applyAdminAction,
  reconcile: (intent) => reconcileAdminAction(intent),
  describeFailure,
  setStatus: publishAdminActionStatus,
  mintIdempotencyKey: (intent) => intent.intentId,
})

export const enqueueAdminActionRuntime = controller.enqueue
export const retryAdminActionRuntime = controller.retry
export const discardAdminActionRuntime = controller.discard
export const clearAdminActions = controller.clearAll
