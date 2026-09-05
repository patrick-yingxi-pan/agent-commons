/** Lazy transport and acknowledgement FIFO behind access-token revocation. */
import {
  applyApiTokenRevocation,
  reconcileApiTokenRevocation,
  type ApiTokenRevocationIntent,
} from '../api/apiTokenRevocationCommands.ts'
import { AccountSwitchedError, ApiRequestError } from '../api'
import { createAcknowledgedActionMutationController } from './acknowledgedActionMutationCore.ts'
import { publishApiTokenRevocationStatus } from './apiTokenRevocationMutations.ts'
import type { RevisionedMutationFailure } from './revisionedMutationCore.ts'

function describeFailure(error: unknown): RevisionedMutationFailure {
  if (error instanceof AccountSwitchedError) {
    return { message: 'That token revocation belonged to the previous account. Dismiss it to continue.', retryable: false }
  }
  if (error instanceof ApiRequestError) {
    if ([400, 401, 403].includes(error.status)) {
      return { message: 'This account can no longer revoke that token. Dismiss the action and review the active registry.', retryable: false }
    }
    if (error.status === 429) {
      return { message: 'Token revocation is temporarily rate-limited. Retry shortly.', retryable: true }
    }
  }
  return {
    message: 'Couldn’t confirm whether that access token was revoked. Retry safely or Dismiss.',
    retryable: true,
  }
}

const controller = createAcknowledgedActionMutationController<ApiTokenRevocationIntent, undefined>({
  resourceId: (intent) => intent.tokenId,
  snapshot: () => undefined,
  mutate: applyApiTokenRevocation,
  reconcile: reconcileApiTokenRevocation,
  describeFailure,
  setStatus: publishApiTokenRevocationStatus,
  mintIdempotencyKey: (intent) => intent.intentId,
})

export const enqueueApiTokenRevocationRuntime = controller.enqueue
export const retryApiTokenRevocationRuntime = controller.retry
export const discardApiTokenRevocationRuntime = controller.discard
export const clearApiTokenRevocations = controller.clearAll
