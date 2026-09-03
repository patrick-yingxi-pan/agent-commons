/** App wiring for conflict-safe provider-definition edits. */
import type { ModelProvider, ProviderDefinitionMutationPatch } from '../../contract/index.ts'
import {
  AccountSwitchedError,
  ApiRequestError,
  keys,
  onAccountSwitch,
  patchProviderDefinition,
  peek,
  reconcileProviderDefinition,
} from '../api'
import {
  createRevisionedMutationController,
  type RevisionedMutationFailure,
  type RevisionedMutationOutcome,
} from './revisionedMutationCore'
import { createMutationStatusStore } from './mutationStatusStore.ts'
import {
  acquireProviderMutation,
  isProviderDefinitionHeld,
  releaseProviderMutation,
} from './providerMutationHolds.ts'

function describeFailure(error: unknown): RevisionedMutationFailure {
  if (error instanceof AccountSwitchedError) {
    return { message: 'That provider change belonged to the previous account. Dismiss it to continue.', retryable: false }
  }
  if (error instanceof ApiRequestError) {
    if (error.status === 409) {
      return {
        message: 'This provider changed elsewhere. The latest version is loaded behind your held edits—review it, then retry or dismiss.',
        retryable: true,
      }
    }
    if (error.status === 400 || error.status === 404) {
      return { message: 'That provider change is no longer valid. Dismiss it and review the latest version.', retryable: false }
    }
    if (error.status === 401 || error.status === 403) {
      return { message: 'You no longer have permission to change that provider. Dismiss it to continue.', retryable: false }
    }
    if (error.status === 429) {
      return { message: 'Too many provider changes at once. Retry in a moment.', retryable: true }
    }
  }
  return { message: 'Couldn’t confirm the provider change. Your edits are still here—retry when the connection recovers.', retryable: true }
}

const statusStore = createMutationStatusStore()

const cachedProvider = (providerId: string): ModelProvider | undefined =>
  peek<ModelProvider[]>(keys.providers)?.find((provider) => provider.id === providerId)

const reconcile = async (providerId: string): Promise<ModelProvider> => {
  const provider = await reconcileProviderDefinition(providerId)
  if (!provider) throw new ApiRequestError('not_found', 'That provider no longer exists.', 404)
  return provider
}

const controller = createRevisionedMutationController<ModelProvider, ProviderDefinitionMutationPatch>({
  snapshot: cachedProvider,
  reconcile,
  revision: (provider) => provider.definitionRevision ?? 0,
  mutate: patchProviderDefinition,
  describeFailure,
  setStatus: statusStore.publish,
  mintIdempotencyKey: () => crypto.randomUUID(),
})

onAccountSwitch(() => controller.clearAll())

export function updateProviderDefinition(
  providerId: string,
  patch: ProviderDefinitionMutationPatch,
): Promise<RevisionedMutationOutcome> {
  const lease = acquireProviderMutation('definition', providerId)
  if (!lease) return Promise.resolve('discarded')
  statusStore.refresh()
  const outcome = controller.enqueue(providerId, patch)
  void outcome.finally(() => {
    releaseProviderMutation(lease)
    statusStore.refresh()
  })
  return outcome
}

export const retryProviderDefinitionMutation = controller.retry
export const discardProviderDefinitionMutation = controller.discard

export { isProviderDefinitionHeld }
export const useProviderDefinitionMutationStatus = statusStore.useStatus
