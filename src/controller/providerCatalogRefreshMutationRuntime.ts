/** Lazy acknowledgement FIFO for endpoint-owned Provider catalog refresh. */
import {
  AccountSwitchedError,
  ApiRequestError,
  reconcileProviderConnection,
  refreshProviderModels,
} from '../api'
import { createAcknowledgedActionMutationController } from './acknowledgedActionMutationCore.ts'
import {
  publishProviderCatalogRefreshStatus,
  type ProviderCatalogRefreshIntent,
} from './providerCatalogRefreshMutations.ts'
import type { RevisionedMutationFailure } from './revisionedMutationCore.ts'

function describeFailure(error: unknown): RevisionedMutationFailure {
  if (error instanceof AccountSwitchedError) {
    return { message: 'That model-catalog refresh belonged to the previous account. Dismiss it to continue.', retryable: false }
  }
  if (error instanceof ApiRequestError) {
    if ([400, 404, 409].includes(error.status)) return { message: error.message, retryable: false }
    if ([401, 403].includes(error.status)) {
      return { message: 'You no longer have permission to refresh this model catalog. Dismiss it to continue.', retryable: false }
    }
    if (error.status === 429) {
      return { message: 'Model-catalog refresh is temporarily rate-limited. Retry shortly.', retryable: true }
    }
  }
  return {
    message: 'Couldn’t confirm whether the model catalog refreshed. Retry safely or Dismiss after an authoritative check.',
    retryable: true,
  }
}

const controller = createAcknowledgedActionMutationController<ProviderCatalogRefreshIntent, undefined>({
  resourceId: (intent) => intent.providerId,
  snapshot: () => undefined,
  mutate: async (intent, idempotencyKey) => {
    await refreshProviderModels(intent.providerId, intent.expectedRevision, idempotencyKey)
  },
  reconcile: async (intent) => {
    // The current public catalog is authoritative display truth, but another
    // device may have advanced the shared connection domain. Only same-key
    // replay proves this exact outbound list-and-replace act landed.
    await reconcileProviderConnection(intent.providerId)
    return false
  },
  discardReconcileFailure: 'retain',
  describeFailure,
  setStatus: publishProviderCatalogRefreshStatus,
  mintIdempotencyKey: (intent) => intent.intentId,
})

export const enqueueProviderCatalogRefreshRuntime = controller.enqueue
export const retryProviderCatalogRefreshRuntime = controller.retry
export const discardProviderCatalogRefreshRuntime = controller.discard
export const clearProviderCatalogRefreshes = controller.clearAll
