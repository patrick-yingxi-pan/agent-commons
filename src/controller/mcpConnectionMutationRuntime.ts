/** Lazy transport and acknowledgement FIFO for external MCP lifecycle acts. */
import { AccountSwitchedError, ApiRequestError } from '../api/client.ts'
import {
  applyMcpConnectionMutation,
  McpCredentialCleanupPendingError,
  McpCredentialCleanupUncertainError,
  reconcileMcpConnectionMutation,
} from '../api/mcpConnectionCommands.ts'
import { mcpConnectionMutationResourceId, type McpConnectionMutationIntent } from '../api/mcpConnectionIntent.ts'
import { createAcknowledgedActionMutationController } from './acknowledgedActionMutationCore.ts'
import { publishMcpConnectionMutationStatus } from './mcpConnectionMutations.ts'
import type { RevisionedMutationFailure } from './revisionedMutationCore.ts'

function describeFailure(error: unknown): RevisionedMutationFailure {
  if (error instanceof McpCredentialCleanupPendingError) {
    return { message: 'Server change saved; device credential cleanup remains pending.', retryable: true }
  }
  if (error instanceof McpCredentialCleanupUncertainError) {
    return { message: 'Couldn’t confirm whether the MCP change or device credential cleanup completed. Retry or Dismiss after an authoritative check.', retryable: true }
  }
  if (error instanceof AccountSwitchedError) {
    return { message: 'That MCP connection change belonged to the previous account. Dismiss it to continue.', retryable: false }
  }
  if (error instanceof ApiRequestError) {
    if (error.status === 502 && error.code === 'upstream_unavailable') {
      return { message: error.message, retryable: true }
    }
    if ([400, 404, 409].includes(error.status)) {
      return { message: error.message, retryable: false }
    }
    if ([401, 403].includes(error.status)) {
      return { message: 'You no longer have permission to change this MCP connection. Dismiss it to continue.', retryable: false }
    }
    if (error.status === 429) {
      return { message: 'MCP connection work is temporarily rate-limited. Retry shortly.', retryable: true }
    }
  }
  return {
    message: 'Couldn’t confirm whether the MCP connection changed. Retry safely or Dismiss after an authoritative check.',
    retryable: true,
  }
}

const mutationErrors = new Map<string, unknown>()
const mutateMcpConnection = async (intent: McpConnectionMutationIntent, idempotencyKey: string): Promise<void> => {
  try {
    await applyMcpConnectionMutation(intent, idempotencyKey)
    mutationErrors.delete(idempotencyKey)
  } catch (error) {
    mutationErrors.set(idempotencyKey, error)
    throw error
  }
}

const reconcileMcpConnection = (
  intent: McpConnectionMutationIntent,
  baseline: import('../../contract/mcpConnections.ts').McpConnectionView | undefined,
  idempotencyKey: string,
): Promise<boolean> => reconcileMcpConnectionMutation(intent, baseline, idempotencyKey, mutationErrors.get(idempotencyKey))

const controller = createAcknowledgedActionMutationController<McpConnectionMutationIntent, import('../../contract/mcpConnections.ts').McpConnectionView | undefined>({
  resourceId: mcpConnectionMutationResourceId,
  snapshot: (intent) => intent.kind === 'create' ? undefined : intent.reviewed,
  mutate: mutateMcpConnection,
  reconcile: reconcileMcpConnection,
  discardReconcileFailure: 'retain',
  describeFailure,
  setStatus: publishMcpConnectionMutationStatus,
  mintIdempotencyKey: (intent) => intent.kind === 'create' ? intent.request.creationId :
    intent.kind === 'inspect' ? intent.request.operationId : crypto.randomUUID(),
})

export const enqueueMcpConnectionMutationRuntime = controller.enqueue
export const retryMcpConnectionMutationRuntime = controller.retry
export const discardMcpConnectionMutationRuntime = controller.discard
export const clearMcpConnectionMutations = () => {
  mutationErrors.clear()
  controller.clearAll()
}
