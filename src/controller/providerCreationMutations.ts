/** Provider onboarding is ready before its form accepts a credential or intent. */
import type { CreateProviderRequest, CreatedProvider } from '../../contract/index.ts'
import { AccountSwitchedError, ApiRequestError } from '../api/client.ts'
import { onAccountSwitch } from '../api/account.ts'
import {
  assertProviderCreationSource,
  captureProviderCreationSource,
  providerCreationResourceId,
  type ProviderCreationIntent,
} from '../api/providerCreationRevision.ts'
import {
  applyProviderCreation,
  clearProviderCreationResults,
  peekProviderCreationResult,
  reconcileProviderCreation,
  takeProviderCreationResult,
} from '../api/providerCreationCommands.ts'
import { bindDesktopCredential, discardDesktopCredential, provisionDesktopCredential } from '../api/desktopCredentials.ts'
import { createAcknowledgedActionMutationController } from './acknowledgedActionMutationCore.ts'
import {
  bindProviderCreationCredential,
  discardProviderCreationCredential,
  prepareProviderCreationCredential,
} from './providerCreationCredentialCore.ts'
import type {
  RevisionedMutationFailure,
  RevisionedMutationOutcome,
} from './revisionedMutationCore.ts'
import { createMutationStatusStore } from './mutationStatusStore.ts'

export interface ProviderCreationMutationResult {
  outcome: RevisionedMutationOutcome
  provider?: CreatedProvider
}

const statusStore = createMutationStatusStore()
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
    if ([400, 404, 409].includes(error.status)) return { message: error.message, retryable: false }
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

// A browser may cache a rejected module URL. One ready queue owns saving and
// recovery; neither is deferred until after the user has submitted the form.
const controller = createAcknowledgedActionMutationController<ProviderCreationIntent, undefined>({
  resourceId: providerCreationResourceId,
  snapshot: () => undefined,
  mutate: async (intent, idempotencyKey) => {
    assertProviderCreationSource(intent)
    await prepareProviderCreationCredential(intent, credentials)
    try {
      assertProviderCreationSource(intent)
    } catch (error) {
      // This attempt has not submitted; an older uncertain attempt still may
      // use the same key. Only never-submitted references are known unused.
      if (!intent.uncertainSubmission) await discardProviderCreationCredential(intent, credentials)
      throw error
    }
    try {
      await applyProviderCreation(intent, idempotencyKey)
    } catch (error) {
      if (!definitelyUnapplied(error)) intent.uncertainSubmission = true
      else if (!intent.uncertainSubmission) await discardProviderCreationCredential(intent, credentials)
      throw error
    }
    assertProviderCreationSource(intent)
    const provider = peekProviderCreationResult(intent.intentId)
    if (provider) await bindProviderCreationCredential(intent, provider.id, credentials)
  },
  reconcile: async (intent, _baseline, idempotencyKey) => {
    const realized = await reconcileProviderCreation(intent, idempotencyKey)
    assertProviderCreationSource(intent)
    const provider = realized ? peekProviderCreationResult(intent.intentId) : undefined
    if (provider) await bindProviderCreationCredential(intent, provider.id, credentials)
    return realized
  },
  describeFailure,
  setStatus: statusStore.publish,
  mintIdempotencyKey: (intent) => intent.intentId,
})

onAccountSwitch(() => {
  controller.clearAll()
  clearProviderCreationResults()
})

export async function enqueueProviderCreation(input: {
  tenantId: string
  request: CreateProviderRequest
  deviceSecret?: string
  credentialReference?: string
}): Promise<ProviderCreationMutationResult> {
  let intent: ProviderCreationIntent
  try {
    intent = {
      ...input,
      ...captureProviderCreationSource(input.tenantId),
      request: structuredClone(input.request),
      intentId: crypto.randomUUID(),
    }
  } catch (error) {
    // Discovery transferred a never-submitted key; the queue has not accepted
    // it yet. After enqueue, only the acknowledgement lifecycle may retire it.
    if (input.credentialReference) await discardDesktopCredential(input.credentialReference).catch(() => {})
    throw error
  }
  // Dismiss and account switching both release the visible intent, but neither
  // can prove a transport-aborted server request is no longer in flight. Keep
  // any uncertain provisional reference for startup reconciliation; cleanup
  // requires proven non-application, not merely an abandoned response.
  const outcome = await controller.enqueue(intent)
  const provider = outcome === 'applied' ? takeProviderCreationResult(intent.intentId) : undefined
  return { outcome, ...(provider ? { provider } : {}) }
}

export const retryProviderCreation = controller.retry
export const discardProviderCreation = controller.discard
export const useProviderCreationStatus = statusStore.useStatus
