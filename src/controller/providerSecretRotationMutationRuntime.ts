/** Lazy transport/recovery boundary behind Session-secret rotation. */
import { AccountSwitchedError, ApiRequestError } from '../api'
import {
  applyProviderSecretRotation,
  cancelProviderSecretRotation,
  recoverProviderSecretRotation,
  type ProviderSecretRotationIntent,
  type ProviderSecretRotationResult,
} from '../api/providerSecretRotationCommands.ts'
import {
  acceptProviderSecretRotation,
  publishProviderSecretRotationStatus,
} from './providerSecretRotationMutations.ts'
import { createRecoverableSecretMutationController } from './recoverableSecretMutationCore.ts'
import type { RevisionedMutationFailure } from './revisionedMutationCore.ts'

function describeFailure(error: unknown): RevisionedMutationFailure {
  if (error instanceof AccountSwitchedError) {
    return { message: 'That secret rotation belonged to the previous account.', retryable: false }
  }
  if (error instanceof ApiRequestError) {
    if ([400, 401, 403, 404, 409].includes(error.status)) {
      return { message: error.message, retryable: false }
    }
    if (error.status === 429) {
      return { message: 'Secret rotation is temporarily rate-limited. Retry shortly.', retryable: true }
    }
  }
  return {
    message: 'Couldn’t confirm whether the relay secret changed. Retry safely or Cancel request.',
    retryable: true,
  }
}

function describeRecoveryAbsence(): RevisionedMutationFailure {
  return {
    message: 'That saved secret rotation did not apply. Retry it safely, or Cancel request.',
    retryable: true,
  }
}

function describeCancelFailure(error: unknown): RevisionedMutationFailure {
  if (error instanceof ApiRequestError && [400, 401, 403, 404].includes(error.status)) {
    return { message: 'This account can no longer cancel that secret rotation.', retryable: false }
  }
  return {
    message: 'Couldn’t confirm cancellation. Retry to recover the secret, or Cancel request again.',
    retryable: true,
  }
}

const controller = createRecoverableSecretMutationController<
  ProviderSecretRotationIntent,
  ProviderSecretRotationResult
>({
  resourceId: (intent) => intent.providerId,
  mutate: applyProviderSecretRotation,
  recover: recoverProviderSecretRotation,
  cancel: cancelProviderSecretRotation,
  accept: acceptProviderSecretRotation,
  describeFailure,
  describeRecoveryAbsence,
  describeCancelFailure,
  setStatus: publishProviderSecretRotationStatus,
  mintIdempotencyKey: (intent) => intent.intentId,
})

export const enqueueProviderSecretRotationRuntime = controller.enqueue
export const resumeProviderSecretRotationRuntime = controller.resume
export const retryProviderSecretRotationRuntime = controller.retry
export const cancelProviderSecretRotationRuntime = controller.cancel
export const clearProviderSecretRotations = controller.clearAll
