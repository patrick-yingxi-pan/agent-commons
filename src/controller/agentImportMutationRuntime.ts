/** Lazy transport and acknowledgement FIFO behind remote Agent Card imports. */
import { AccountSwitchedError, ApiRequestError } from '../api'
import {
  applyAgentImport,
  reconcileAgentImport,
  type AgentImportIntent,
} from '../api/agentImportCommands.ts'
import { createAcknowledgedActionMutationController } from './acknowledgedActionMutationCore.ts'
import { publishAgentImportStatus } from './agentImportMutations.ts'
import type { RevisionedMutationFailure } from './revisionedMutationCore.ts'

function describeFailure(error: unknown): RevisionedMutationFailure {
  if (error instanceof AccountSwitchedError) {
    return { message: 'That import belonged to the previous account. Dismiss it to continue.', retryable: false }
  }
  if (error instanceof ApiRequestError) {
    if (error.code === 'upstream_unavailable') {
      return { message: 'The remote Agent Card is unavailable. Retry, or Dismiss to edit the URL.', retryable: true }
    }
    if ([400, 404, 409].includes(error.status)) {
      return { message: error.message, retryable: false }
    }
    if ([401, 403].includes(error.status)) {
      return { message: 'You no longer have permission to import this Agent Card. Dismiss it to continue.', retryable: false }
    }
    if (error.status === 429) {
      return { message: 'Agent Card import is temporarily rate-limited. Retry shortly.', retryable: true }
    }
  }
  return {
    message: 'Couldn’t confirm whether the Agent Card was imported. Retry safely or Dismiss.',
    retryable: true,
  }
}

const controller = createAcknowledgedActionMutationController<AgentImportIntent, undefined>({
  resourceId: (intent) => intent.request.url,
  snapshot: () => undefined,
  mutate: applyAgentImport,
  reconcile: reconcileAgentImport,
  describeFailure,
  setStatus: publishAgentImportStatus,
  mintIdempotencyKey: (intent) => intent.intentId,
})

export const enqueueAgentImportRuntime = controller.enqueue
export const retryAgentImportRuntime = controller.retry
export const discardAgentImportRuntime = controller.discard
export const clearAgentImports = controller.clearAll
