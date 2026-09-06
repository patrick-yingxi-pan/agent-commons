/** Lazy transport and acknowledgement queue for write-only Provider connection changes. */
import {
  AccountSwitchedError,
  ApiRequestError,
  bindDesktopCredential,
  discardDesktopCredential,
  provisionDesktopCredential,
  reconcileProviderConnection,
  updateProviderConnection,
} from '../api'
import { createAcknowledgedActionMutationController } from './acknowledgedActionMutationCore.ts'
import {
  publishProviderConnectionStatus,
  type ProviderConnectionIntent,
} from './providerConnectionMutations.ts'
import {
  replaceProviderConnectionCore,
  type ProviderConnectionDependencies,
} from './providerConnectionCore.ts'
import type { RevisionedMutationFailure } from './revisionedMutationCore.ts'
const dependencies: ProviderConnectionDependencies = {
  provision: provisionDesktopCredential,
  update: updateProviderConnection,
  bind: bindDesktopCredential,
  discard: discardDesktopCredential,
  definitiveFailure: (error) =>
    error instanceof ApiRequestError && [400, 401, 403, 404, 409, 429].includes(error.status),
}

function describeFailure(error: unknown): RevisionedMutationFailure {
  if (error instanceof AccountSwitchedError) {
    return { message: 'That connection update belonged to the previous account.', retryable: false }
  }
  if (error instanceof ApiRequestError) {
    if (error.status === 429) {
      return { message: 'Connection verification is temporarily rate-limited. Retry shortly.', retryable: true }
    }
    if ([400, 404, 409].includes(error.status)) return { message: error.message, retryable: false }
    if ([401, 403].includes(error.status)) {
      return { message: 'You no longer have permission to update this connection. Dismiss it to continue.', retryable: false }
    }
  }
  return {
    message: 'Couldn’t confirm whether this connection changed. Retry safely or Dismiss after an authoritative check.',
    retryable: true,
  }
}

const controller = createAcknowledgedActionMutationController<ProviderConnectionIntent, undefined>({
  resourceId: (intent) => intent.providerId,
  snapshot: () => undefined,
  mutate: async (intent) => {
    await replaceProviderConnectionCore(intent.providerId, intent.attempt, dependencies)
  },
  reconcile: async (intent) => {
    // Provider reads expose only a revision, never the hidden endpoint or
    // credential reference. Refresh the addressed row, but do not infer that
    // this exact write landed; only replaying its key can prove that.
    await reconcileProviderConnection(intent.providerId)
    return false
  },
  settleRejected: (_error, intent) => intent.attempt.uncertain ? undefined : 'discarded',
  discardReconcileFailure: 'retain',
  describeFailure,
  setStatus: publishProviderConnectionStatus,
  mintIdempotencyKey: (intent) => intent.attempt.idempotencyKey,
})

export const enqueueProviderConnectionRuntime = controller.enqueue
export const retryProviderConnectionRuntime = controller.retry
export const discardProviderConnectionRuntime = controller.discard
export const clearProviderConnections = controller.clearAll
