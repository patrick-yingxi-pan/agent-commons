/** Lazy server-removal and desktop-vault cleanup saga for Providers. */
import type { ModelProvider } from '../../contract/index.ts'
import {
  AccountSwitchedError,
  ApiRequestError,
  deleteProvider,
  type ProviderDeletionPrecondition,
  reconcileProviderDefinition,
  removeDesktopProviderCredentials,
} from '../api'
import { createRevisionedDeletionMutationController } from './revisionedDeletionCore.ts'
import { publishProviderDeletionStatus } from './providerDeletionMutations.ts'
import type { RevisionedMutationFailure } from './revisionedMutationCore.ts'

class ProviderCredentialCleanupError extends Error {
  constructor(cause: unknown) {
    super('The provider was removed, but its credential could not be erased from this device.', { cause })
    this.name = 'ProviderCredentialCleanupError'
  }
}

const acknowledgedProviderByKey = new Map<string, string>()

async function cleanDeviceCredential(providerId: string): Promise<void> {
  try {
    await removeDesktopProviderCredentials(providerId)
  } catch (error) {
    throw new ProviderCredentialCleanupError(error)
  }
}

function clearAcknowledgedProvider(providerId: string): void {
  for (const [key, id] of acknowledgedProviderByKey) {
    if (id === providerId) acknowledgedProviderByKey.delete(key)
  }
}

async function reconcile(providerId: string): Promise<ModelProvider | null> {
  const provider = await reconcileProviderDefinition(providerId)
  if (provider) return provider
  await cleanDeviceCredential(providerId)
  clearAcknowledgedProvider(providerId)
  return null
}

async function mutate(
  providerId: string,
  expected: ProviderDeletionPrecondition,
  idempotencyKey: string,
): Promise<void> {
  if (!acknowledgedProviderByKey.has(idempotencyKey)) {
    await deleteProvider(providerId, expected, idempotencyKey)
    acknowledgedProviderByKey.set(idempotencyKey, providerId)
  }
  await cleanDeviceCredential(providerId)
  acknowledgedProviderByKey.delete(idempotencyKey)
}

function describeFailure(error: unknown): RevisionedMutationFailure & { rebaseOnRetry: boolean } {
  if (error instanceof ProviderCredentialCleanupError) {
    return {
      message: 'The Provider is removed, but this device could not erase its stored credential. Retry cleanup, or Dismiss to let desktop startup reconciliation remove it later.',
      retryable: true,
      rebaseOnRetry: false,
    }
  }
  if (error instanceof AccountSwitchedError) {
    return {
      message: 'That Provider removal belonged to the previous account. Dismiss it to continue.',
      retryable: false,
      rebaseOnRetry: false,
    }
  }
  if (error instanceof ApiRequestError) {
    if (error.status === 409 && /agent/i.test(error.message)) {
      return {
        message: 'An Agent still uses this Provider. Repoint its model provider, then Retry removal.',
        retryable: true,
        rebaseOnRetry: false,
      }
    }
    if (error.status === 409 && /default provider/i.test(error.message)) {
      return {
        message: 'The default Provider cannot be removed. Dismiss this removal to continue.',
        retryable: false,
        rebaseOnRetry: false,
      }
    }
    if (error.status === 409) {
      return {
        message: 'This Provider changed elsewhere. The latest definition and connection are loaded—review them, then retry removal or dismiss.',
        retryable: true,
        rebaseOnRetry: true,
      }
    }
    if ([400, 404].includes(error.status)) {
      return {
        message: 'That Provider is no longer available. Dismiss the removal to continue.',
        retryable: false,
        rebaseOnRetry: false,
      }
    }
    if ([401, 403].includes(error.status)) {
      return {
        message: 'You no longer have permission to remove that Provider. Dismiss it to continue.',
        retryable: false,
        rebaseOnRetry: false,
      }
    }
    if (error.status === 429) {
      return {
        message: 'Too many Provider changes at once. Retry removal in a moment.',
        retryable: true,
        rebaseOnRetry: false,
      }
    }
  }
  return {
    message: 'Couldn’t confirm removal. The Provider remains visible—Retry when the connection recovers or Dismiss.',
    retryable: true,
    rebaseOnRetry: false,
  }
}

const controller = createRevisionedDeletionMutationController<
  ModelProvider,
  ProviderDeletionPrecondition
>({
  reconcile,
  mutate,
  revision: (provider) => ({
    expectedDefinitionRevision: provider.definitionRevision ?? 0,
    expectedConnectionRevision: provider.connectionRevision ?? 0,
  }),
  describeFailure,
  setStatus: publishProviderDeletionStatus,
  mintIdempotencyKey: () => crypto.randomUUID(),
})

export const enqueueProviderDeletionRuntime = controller.enqueue
export const retryProviderDeletionRuntime = controller.retry
export const discardProviderDeletionRuntime = controller.discard
export const clearProviderDeletions = (): void => {
  acknowledgedProviderByKey.clear()
  controller.clearAll()
}
