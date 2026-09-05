/** Lazy acknowledgement FIFO behind owner invitation actions. */
import { AccountSwitchedError, ApiRequestError } from '../api'
import {
  applyOrgInviteOwnerAction,
  reconcileOrgInviteOwnerAction,
} from '../api/orgInviteOwnerCommands.ts'
import {
  orgInviteOwnerResourceId,
  type OrgInviteOwnerIntent,
} from '../api/orgInviteOwnerRevision.ts'
import { createAcknowledgedActionMutationController } from './acknowledgedActionMutationCore.ts'
import { publishOrgInviteOwnerStatus } from './orgInviteOwnerMutations.ts'
import type { RevisionedMutationFailure } from './revisionedMutationCore.ts'

function describeFailure(error: unknown): RevisionedMutationFailure {
  if (error instanceof AccountSwitchedError) {
    return { message: 'That invitation action belonged to the previous account. Dismiss it to continue.', retryable: false }
  }
  if (error instanceof ApiRequestError) {
    if ([400, 404, 409].includes(error.status)) return { message: error.message, retryable: false }
    if ([401, 403].includes(error.status)) {
      return { message: 'You can no longer manage invitations for that organization. Dismiss it to continue.', retryable: false }
    }
    if (error.status === 429) {
      return { message: 'Organization invitations are temporarily rate-limited. Retry shortly.', retryable: true }
    }
  }
  return {
    message: 'Couldn’t confirm that organization invitation action. Retry safely or Dismiss.',
    retryable: true,
  }
}

const controller = createAcknowledgedActionMutationController<OrgInviteOwnerIntent, undefined>({
  resourceId: orgInviteOwnerResourceId,
  snapshot: () => undefined,
  mutate: applyOrgInviteOwnerAction,
  reconcile: reconcileOrgInviteOwnerAction,
  describeFailure,
  setStatus: publishOrgInviteOwnerStatus,
  mintIdempotencyKey: (intent) => intent.intentId,
})

export const enqueueOrgInviteOwnerRuntime = controller.enqueue
export const retryOrgInviteOwnerRuntime = controller.retry
export const discardOrgInviteOwnerRuntime = controller.discard
export const clearOrgInviteOwnerActions = controller.clearAll
