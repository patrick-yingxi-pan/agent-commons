/** Lazy transport/recovery boundary behind hosted access-token minting. */
import type { BearerSession } from '../../contract/index.ts'
import { AccountSwitchedError, ApiRequestError } from '../api'
import {
  applyApiTokenMint,
  cancelApiTokenMint,
  recoverApiTokenMint,
  type ApiTokenMintIntent,
} from '../api/apiTokenMintCommands.ts'
import {
  acceptApiTokenMint,
  publishApiTokenMintStatus,
} from './apiTokenMintMutations.ts'
import { createRecoverableSecretMutationController } from './recoverableSecretMutationCore.ts'
import type { RevisionedMutationFailure } from './revisionedMutationCore.ts'

function describeFailure(error: unknown): RevisionedMutationFailure {
  if (error instanceof AccountSwitchedError) {
    return { message: 'That token request belonged to the previous account.', retryable: false }
  }
  if (error instanceof ApiRequestError) {
    if ([400, 401, 403, 409].includes(error.status)) {
      return { message: error.message, retryable: false }
    }
    if (error.status === 429) {
      return { message: 'Token minting is temporarily rate-limited. Retry shortly.', retryable: true }
    }
  }
  return {
    message: 'Couldn’t confirm whether the access token was created. Retry safely or Cancel request.',
    retryable: true,
  }
}

function describeRecoveryAbsence(): RevisionedMutationFailure {
  return {
    message: 'That saved token request was not created. Retry to mint it safely, or Cancel request.',
    retryable: true,
  }
}

function describeCancelFailure(error: unknown): RevisionedMutationFailure {
  if (error instanceof ApiRequestError && [400, 401, 403].includes(error.status)) {
    return { message: 'This account can no longer cancel that token request.', retryable: false }
  }
  return {
    message: 'Couldn’t confirm cancellation. Retry to recover the token, or Cancel request again.',
    retryable: true,
  }
}

const controller = createRecoverableSecretMutationController<ApiTokenMintIntent, BearerSession>({
  resourceId: (intent) => intent.identityKey,
  mutate: applyApiTokenMint,
  recover: recoverApiTokenMint,
  cancel: cancelApiTokenMint,
  accept: acceptApiTokenMint,
  describeFailure,
  describeRecoveryAbsence,
  describeCancelFailure,
  setStatus: publishApiTokenMintStatus,
  mintIdempotencyKey: (intent) => intent.intentId,
})

export const enqueueApiTokenMintRuntime = controller.enqueue
export const resumeApiTokenMintRuntime = controller.resume
export const retryApiTokenMintRuntime = controller.retry
export const cancelApiTokenMintRuntime = controller.cancel
export const clearApiTokenMints = controller.clearAll
