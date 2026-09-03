/** App wiring for conflict-safe system-prompt definition edits. */
import type { SystemPromptDefinitionMutationPatch, SystemPromptEntry } from '../../contract/index.ts'
import {
  AccountSwitchedError,
  ApiRequestError,
  keys,
  onAccountSwitch,
  patchSystemPromptDefinition,
  peek,
  reconcileSystemPromptDefinition,
} from '../api'
import {
  createRevisionedMutationController,
  type RevisionedMutationFailure,
  type RevisionedMutationOutcome,
} from './revisionedMutationCore'
import { createMutationStatusStore } from './mutationStatusStore.ts'
import {
  acquireSystemPromptMutation,
  isSystemPromptDefinitionHeld,
  releaseSystemPromptMutation,
} from './systemPromptMutationHolds.ts'

function describeFailure(error: unknown): RevisionedMutationFailure {
  if (error instanceof AccountSwitchedError) {
    return { message: 'That prompt change belonged to the previous account. Dismiss it to continue.', retryable: false }
  }
  if (error instanceof ApiRequestError) {
    if (error.status === 409) {
      return {
        message: 'This prompt changed elsewhere. The latest version is loaded behind your held edits—review it, then retry or dismiss.',
        retryable: true,
      }
    }
    if (error.status === 400 || error.status === 404) {
      return { message: 'That prompt change is no longer valid. Dismiss it and review the latest version.', retryable: false }
    }
    if (error.status === 401 || error.status === 403) {
      return { message: 'You no longer have permission to change that prompt. Dismiss it to continue.', retryable: false }
    }
    if (error.status === 429) return { message: 'Too many prompt changes at once. Retry in a moment.', retryable: true }
  }
  return { message: 'Couldn’t confirm the prompt change. Your edits are still here—retry when the connection recovers.', retryable: true }
}

const statusStore = createMutationStatusStore()

const cachedPrompt = (promptId: string): SystemPromptEntry | undefined =>
  peek<SystemPromptEntry[]>(keys.systemPrompts)?.find((prompt) => prompt.id === promptId)

const reconcile = async (promptId: string): Promise<SystemPromptEntry> => {
  const prompt = await reconcileSystemPromptDefinition(promptId)
  if (!prompt) throw new ApiRequestError('not_found', 'That prompt no longer exists.', 404)
  return prompt
}

const controller = createRevisionedMutationController<SystemPromptEntry, SystemPromptDefinitionMutationPatch>({
  snapshot: cachedPrompt,
  reconcile,
  revision: (prompt) => prompt.definitionRevision ?? 0,
  mutate: patchSystemPromptDefinition,
  describeFailure,
  setStatus: statusStore.publish,
  mintIdempotencyKey: () => crypto.randomUUID(),
})

onAccountSwitch(() => controller.clearAll())

export function updateSystemPromptDefinition(
  promptId: string,
  patch: SystemPromptDefinitionMutationPatch,
): Promise<RevisionedMutationOutcome> {
  const lease = acquireSystemPromptMutation('definition', promptId)
  if (!lease) return Promise.resolve('discarded')
  statusStore.refresh()
  const outcome = controller.enqueue(promptId, patch)
  void outcome.finally(() => {
    releaseSystemPromptMutation(lease)
    statusStore.refresh()
  })
  return outcome
}

export const retrySystemPromptDefinitionMutation = controller.retry
export const discardSystemPromptDefinitionMutation = controller.discard

export { isSystemPromptDefinitionHeld }
export const useSystemPromptDefinitionMutationStatus = statusStore.useStatus
