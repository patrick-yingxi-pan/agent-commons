/** Lazy transport and acknowledgement FIFO behind system-prompt creation. */
import { AccountSwitchedError, ApiRequestError } from '../api'
import {
  applySystemPromptCreation,
  reconcileSystemPromptCreation,
} from '../api/systemPromptCreationCommands.ts'
import {
  systemPromptCreationResourceId,
  type SystemPromptCreationIntent,
} from '../api/systemPromptCreationRevision.ts'
import { createAcknowledgedActionMutationController } from './acknowledgedActionMutationCore.ts'
import { publishSystemPromptCreationStatus } from './systemPromptCreationMutations.ts'
import type { RevisionedMutationFailure } from './revisionedMutationCore.ts'

function describeFailure(error: unknown): RevisionedMutationFailure {
  if (error instanceof AccountSwitchedError) {
    return { message: 'That prompt belonged to the previous account. Dismiss it to continue.', retryable: false }
  }
  if (error instanceof ApiRequestError) {
    if ([400, 404, 409].includes(error.status)) {
      return { message: error.message, retryable: false }
    }
    if ([401, 403].includes(error.status)) {
      return { message: 'You no longer have permission to create this prompt. Dismiss it to continue.', retryable: false }
    }
    if (error.status === 429) {
      return { message: 'Prompt creation is temporarily rate-limited. Retry shortly.', retryable: true }
    }
  }
  return {
    message: 'Couldn’t confirm whether the prompt was created. Prompts were refreshed—Retry safely or Dismiss.',
    retryable: true,
  }
}

const controller = createAcknowledgedActionMutationController<SystemPromptCreationIntent, undefined>({
  resourceId: systemPromptCreationResourceId,
  snapshot: () => undefined,
  mutate: applySystemPromptCreation,
  reconcile: (intent, _baseline, idempotencyKey) => reconcileSystemPromptCreation(intent, idempotencyKey),
  describeFailure,
  setStatus: publishSystemPromptCreationStatus,
  mintIdempotencyKey: (intent) => intent.intentId,
})

export const enqueueSystemPromptCreationRuntime = controller.enqueue
export const retrySystemPromptCreationRuntime = controller.retry
export const discardSystemPromptCreationRuntime = controller.discard
export const clearSystemPromptCreations = controller.clearAll
