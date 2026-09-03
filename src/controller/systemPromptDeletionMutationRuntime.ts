/** Lazy transport and destructive FIFO behind System Prompt removal. */
import type { SystemPromptEntry } from '../../contract/index.ts'
import {
  AccountSwitchedError,
  ApiRequestError,
  deleteSystemPrompt,
  reconcileSystemPromptDefinition,
} from '../api'
import { createRevisionedDeletionMutationController } from './revisionedDeletionCore.ts'
import { publishSystemPromptDeletionStatus } from './systemPromptDeletionMutations.ts'
import type { RevisionedMutationFailure } from './revisionedMutationCore.ts'

function describeFailure(error: unknown): RevisionedMutationFailure & { rebaseOnRetry: boolean } {
  if (error instanceof AccountSwitchedError) {
    return {
      message: 'That prompt removal belonged to the previous account. Dismiss it to continue.',
      retryable: false,
      rebaseOnRetry: false,
    }
  }
  if (error instanceof ApiRequestError) {
    if (error.status === 409 && /agent/i.test(error.message)) {
      return {
        message: 'An Agent still uses this prompt. Choose another prompt for it, then Retry removal.',
        retryable: true,
        rebaseOnRetry: false,
      }
    }
    if (error.status === 409 && /default system prompt/i.test(error.message)) {
      return {
        message: 'The built-in default prompt cannot be removed. Dismiss this removal to continue.',
        retryable: false,
        rebaseOnRetry: false,
      }
    }
    if (error.status === 409) {
      return {
        message: 'This prompt changed elsewhere. The latest definition is loaded—review it, then retry removal or dismiss.',
        retryable: true,
        rebaseOnRetry: true,
      }
    }
    if ([400, 404].includes(error.status)) {
      return {
        message: 'That prompt is no longer available. Dismiss the removal to continue.',
        retryable: false,
        rebaseOnRetry: false,
      }
    }
    if ([401, 403].includes(error.status)) {
      return {
        message: 'You no longer have permission to remove that prompt. Dismiss it to continue.',
        retryable: false,
        rebaseOnRetry: false,
      }
    }
    if (error.status === 429) {
      return {
        message: 'Too many prompt changes at once. Retry removal in a moment.',
        retryable: true,
        rebaseOnRetry: false,
      }
    }
  }
  return {
    message: 'Couldn’t confirm removal. The prompt remains visible—Retry when the connection recovers or Dismiss.',
    retryable: true,
    rebaseOnRetry: false,
  }
}

const controller = createRevisionedDeletionMutationController<SystemPromptEntry>({
  reconcile: async (promptId) => (await reconcileSystemPromptDefinition(promptId)) ?? null,
  mutate: deleteSystemPrompt,
  revision: (prompt) => prompt.definitionRevision ?? 0,
  describeFailure,
  setStatus: publishSystemPromptDeletionStatus,
  mintIdempotencyKey: () => crypto.randomUUID(),
})

export const enqueueSystemPromptDeletionRuntime = controller.enqueue
export const retrySystemPromptDeletionRuntime = controller.retry
export const discardSystemPromptDeletionRuntime = controller.discard
export const clearSystemPromptDeletions = controller.clearAll
