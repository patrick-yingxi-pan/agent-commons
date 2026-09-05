/** Lazy transport and acknowledgement FIFO behind invitation decisions. */
import { AccountSwitchedError, ApiRequestError } from '../api'
import {
  applyOrgInviteVerdict,
  reconcileOrgInviteVerdict,
} from '../api/orgInviteVerdictCommands.ts'
import {
  orgInviteVerdictResourceId,
  type OrgInviteVerdictIntent,
} from '../api/orgInviteVerdictRevision.ts'
import { createAcknowledgedActionMutationController } from './acknowledgedActionMutationCore.ts'
import { publishOrgInviteVerdictStatus } from './orgInviteVerdictMutations.ts'
import type { RevisionedMutationFailure } from './revisionedMutationCore.ts'

function describeFailure(error: unknown): RevisionedMutationFailure {
  if (error instanceof AccountSwitchedError) {
    return { message: 'That invitation decision belonged to the previous account. Dismiss it to continue.', retryable: false }
  }
  if (error instanceof ApiRequestError) {
    if ([400, 404, 409].includes(error.status)) {
      return { message: 'That invitation is no longer available for this decision. Dismiss it and review your organizations.', retryable: false }
    }
    if ([401, 403].includes(error.status)) {
      return { message: 'This account can no longer decide that invitation. Dismiss it to continue.', retryable: false }
    }
    if (error.status === 429) {
      return { message: 'Invitation decisions are temporarily rate-limited. Retry shortly.', retryable: true }
    }
  }
  return {
    message: 'Couldn’t confirm that invitation decision. Retry safely or Dismiss.',
    retryable: true,
  }
}

const controller = createAcknowledgedActionMutationController<OrgInviteVerdictIntent, undefined>({
  resourceId: orgInviteVerdictResourceId,
  snapshot: () => undefined,
  mutate: applyOrgInviteVerdict,
  reconcile: reconcileOrgInviteVerdict,
  describeFailure,
  setStatus: publishOrgInviteVerdictStatus,
  mintIdempotencyKey: (intent) => intent.intentId,
})

export const enqueueOrgInviteVerdictRuntime = controller.enqueue
export const retryOrgInviteVerdictRuntime = controller.retry
export const discardOrgInviteVerdictRuntime = controller.discard
export const clearOrgInviteVerdicts = controller.clearAll
