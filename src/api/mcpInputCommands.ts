/** One-shot private form transport. Receipt recovery never calls POST. */
import type { McpInputCommand, McpInputReceipt, McpInputReviewState } from '../../contract/mcpInput.ts'
import { apiGet, apiPost, ApiRequestError } from './client.ts'
import { evictPrefix, invalidate, invalidatePrefix } from './cache.ts'
import { keys, paths } from './keys.ts'
import { refreshOpenSession } from './sessionRefresh.ts'

export interface McpInputScope {
  readonly sessionId: string
  readonly activityId: string
  readonly decisionId: string
  readonly sourceUserId: string | null
}

export function invalidateMcpInput(sessionId: string): void {
  invalidate(keys.session(sessionId))
  invalidatePrefix(keys.mcpInputPrefix(sessionId))
  refreshOpenSession(sessionId)
}

/** Retire old review controls before releasing an explicit fresh-review hold.
 * The query owns the replacement read; its generation fences crossed replies. */
export function refreshMcpInputReview(sessionId: string): void {
  evictPrefix(keys.mcpInputPrefix(sessionId))
  invalidate(keys.session(sessionId))
  refreshOpenSession(sessionId)
}

export async function readMcpInput(scope: McpInputScope): Promise<McpInputReviewState> {
  const value = await apiGet<McpInputReviewState>(paths.mcpInput(scope.sessionId, scope.activityId, scope.decisionId), {
    expectedSessionUserId: scope.sourceUserId,
    signal: AbortSignal.timeout(15_000),
  })
  if (!value?.activity || value.activity.id !== scope.activityId || value.activity.decisionId !== scope.decisionId ||
      (value.review !== null && (!value.review || value.review.decisionId !== scope.decisionId))) {
    throw new Error('The private review did not match this exact tool decision.')
  }
  return value
}

function exactReceipt(value: McpInputReceipt, scope: McpInputScope, command: McpInputCommand): McpInputReceipt {
  if (!value || value.responseId !== command.responseId || value.decisionId !== command.decisionId ||
      value.round !== command.round || value.action !== command.action ||
      value.activity?.id !== scope.activityId || value.activity.decisionId !== scope.decisionId) {
    throw new Error('The acknowledgement did not match the exact reviewed response.')
  }
  return value
}

export async function submitMcpInputOnce(scope: McpInputScope, command: McpInputCommand): Promise<McpInputReceipt> {
  const receipt = exactReceipt(await apiPost<McpInputReceipt>(
    paths.mcpInput(scope.sessionId, scope.activityId), command,
    { expectedSessionUserId: scope.sourceUserId, signal: AbortSignal.timeout(45_000) },
  ), scope, command)
  invalidateMcpInput(scope.sessionId)
  return receipt
}

export async function readMcpInputReceipt(scope: McpInputScope, command: McpInputCommand): Promise<McpInputReceipt | undefined> {
  try {
    const receipt = exactReceipt(await apiGet<McpInputReceipt>(
      paths.mcpInputReceipt(scope.sessionId, scope.activityId, command.responseId, command.decisionId),
      { expectedSessionUserId: scope.sourceUserId, signal: AbortSignal.timeout(15_000) },
    ), scope, command)
    invalidateMcpInput(scope.sessionId)
    return receipt
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) return undefined
    throw error
  }
}
