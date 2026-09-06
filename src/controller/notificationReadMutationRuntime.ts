/** Lazy acknowledgement FIFO behind notification triage. */
import { AccountSwitchedError, ApiRequestError } from '../api'
import {
  applyNotificationRead,
  notificationReadResourceId,
  reconcileNotificationRead,
  type NotificationReadIntent,
} from '../api/notificationReadCommands.ts'
import { createAcknowledgedActionMutationController } from './acknowledgedActionMutationCore.ts'
import { publishNotificationReadStatus } from './notificationReadMutations.ts'
import type { RevisionedMutationFailure } from './revisionedMutationCore.ts'

function describeFailure(error: unknown): RevisionedMutationFailure {
  if (error instanceof AccountSwitchedError) {
    return { message: 'That notification choice belonged to the previous account. Dismiss it to continue.', retryable: false }
  }
  if (error instanceof ApiRequestError) {
    if ([400, 404, 409].includes(error.status)) {
      return { message: 'Those notifications are no longer available. Dismiss this choice and review the latest inbox.', retryable: false }
    }
    if ([401, 403].includes(error.status)) {
      return { message: 'You no longer have permission to update that inbox. Dismiss this choice to continue.', retryable: false }
    }
    if (error.status === 429) {
      return { message: 'Notification updates are temporarily rate-limited. Retry shortly.', retryable: true }
    }
  }
  return { message: 'Couldn’t confirm which notifications were read. Retry safely or Dismiss.', retryable: true }
}

const controller = createAcknowledgedActionMutationController<NotificationReadIntent, undefined>({
  resourceId: (intent) => notificationReadResourceId(intent.ids),
  snapshot: () => undefined,
  mutate: applyNotificationRead,
  reconcile: (intent) => reconcileNotificationRead(intent),
  describeFailure,
  setStatus: publishNotificationReadStatus,
  mintIdempotencyKey: (intent) => intent.intentId,
})

export const enqueueNotificationReadRuntime = controller.enqueue
export const retryNotificationReadRuntime = controller.retry
export const discardNotificationReadRuntime = controller.discard
export const clearNotificationReads = controller.clearAll
