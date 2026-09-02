/** Lazy transport, credential lifecycle, and acknowledgement FIFO for provider creation. */
import { AccountSwitchedError, ApiRequestError } from '../api'
import {
  applyProviderCreation,
  clearProviderCreationResults,
  peekProviderCreationResult,
  reconcileProviderCreation,
  takeProviderCreationResult,
} from '../api/providerCreationCommands.ts'
import {
  providerCreationResourceId,
  type ProviderCreationIntent,
} from '../api/providerCreationRevision.ts'
import {
  bindDesktopCredential,
  discardDesktopCredential,
  provisionDesktopCredential,
} from '../api/desktopCredentials.ts'
import { createAcknowledgedActionMutationController } from './acknowledgedActionMutationCore.ts'
import {
  bindProviderCreationCredential,
  discardProviderCreationCredential,
  prepareProviderCreationCredential,
} from './providerCreationCredentialCore.ts'
import {
  publishProviderCreationStatus,
  type ProviderCreationMutationResult,
} from './providerCreationMutations.ts'
import type { RevisionedMutationFailure } from './revisionedMutationCore.ts'

const credentials = {
  provision: provisionDesktopCredential,
  bind: bindDesktopCredential,
  discard: discardDesktopCredential,
}

const definitelyUnapplied = (error: unknown): boolean =>
  error instanceof ApiRequestError && [400, 401, 403, 404, 409].includes(error.status)

function describeFailure(error: unknown): RevisionedMutationFailure {
  if (error instanceof AccountSwitchedError) {
    return { message: 'That provider belonged to the previous account. Dismiss it to continue.', retryable: false }
  }
  if (error instanceof ApiRequestError) {
    if ([400, 404, 409].includes(error.status)) {
      return { message: error.message, retryable: false }
    }
    if ([401, 403].includes(error.status)) {
      return { message: 'You no longer have permission to create this provider. Dismiss it to continue.', retryable: false }
    }
    if (error.status === 429) {
      return { message: 'Provider creation is temporarily rate-limited. Retry shortly.', retryable: true }
    }
  }
  return {
    message: 'Couldn’t confirm the provider. Retry safely or Dismiss after an authoritative check.',
    retryable: true,
  }
}

const controller = createAcknowledgedActionMutationController<ProviderCreationIntent, undefined>({
  resourceId: providerCreationResourceId,
  snapshot: () => undefined,
  mutate: async (intent, idempotencyKey) => {
    await prepareProviderCreationCredential(intent, credentials)
    try {
      await applyProviderCreation(intent, idempotencyKey)
    } catch (error) {
      if (definitelyUnapplied(error)) await discardProviderCreationCredential(intent, credentials)
      throw error
    }
    const provider = peekProviderCreationResult(intent.intentId)
    if (provider) await bindProviderCreationCredential(intent, provider.id, credentials)
  },
  reconcile: async (intent, _baseline, idempotencyKey) => {
    const realized = await reconcileProviderCreation(intent, idempotencyKey)
    const provider = realized ? peekProviderCreationResult(intent.intentId) : undefined
    if (provider) await bindProviderCreationCredential(intent, provider.id, credentials)
    return realized
  },
  describeFailure,
  setStatus: publishProviderCreationStatus,
  mintIdempotencyKey: (intent) => intent.intentId,
})

export async function enqueueProviderCreationRuntime(
  intent: ProviderCreationIntent,
): Promise<ProviderCreationMutationResult> {
  const outcome = await controller.enqueue(intent)
  const provider = outcome === 'applied'
    ? takeProviderCreationResult(intent.intentId)
    : undefined
  return { outcome, ...(provider ? { provider } : {}) }
}

export const retryProviderCreationRuntime = controller.retry
export const discardProviderCreationRuntime = controller.discard

export function clearProviderCreations(): void {
  controller.clearAll()
  clearProviderCreationResults()
}
