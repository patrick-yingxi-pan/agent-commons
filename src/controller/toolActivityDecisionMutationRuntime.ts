/** Lazy acknowledgement controller behind conversation tool-consent decisions. */
import { AccountSwitchedError, ApiRequestError } from '../api'
import type { ToolActivity } from '../../contract/index.ts'
import {
  applyToolActivityDecision,
  reconcileToolActivityDecision,
  type ToolActivityDecisionIntent,
} from '../api/toolActivityDecisionCommands.ts'
import { createAcknowledgedActionMutationController } from './acknowledgedActionMutationCore.ts'
import { conversations } from './conversationStore.ts'
import { publishToolActivityDecisionStatus } from './toolActivityDecisionMutations.ts'
import type { RevisionedMutationFailure } from './revisionedMutationCore.ts'

/** Merge only the addressed terminal activity into the live transcript. A late
 * acknowledgement must not replace newer messages or another activity row. */
function rememberActivity(sessionId: string, activity: ToolActivity): void {
  conversations.setLive(sessionId, (live) => ({
    ...live,
    messages: live.messages.map((message) => message.toolActivities?.some((candidate) => candidate.id === activity.id)
      ? {
          ...message,
          toolActivities: message.toolActivities.map((candidate) =>
            candidate.id === activity.id ? activity : candidate),
        }
      : message),
  }))
}

function describeFailure(error: unknown): RevisionedMutationFailure {
  if (error instanceof AccountSwitchedError) {
    return { message: 'That tool decision belonged to the previous account. Dismiss it to continue.', retryable: false }
  }
  if (error instanceof ApiRequestError) {
    if (error.status === 400 || error.status === 404) {
      return { message: 'This exact tool decision can no longer be applied. Dismiss it and review the current activity.', retryable: false }
    }
    if (error.status === 401 || error.status === 403) {
      return { message: 'You no longer have permission to decide this tool action. Dismiss it to continue.', retryable: false }
    }
    if (error.status === 409) {
      return {
        message: `${error.message} Retry safely, or Dismiss to choose again.`,
        retryable: true,
      }
    }
    if (error.status === 429) {
      return { message: 'Tool decisions are temporarily rate-limited. Retry shortly.', retryable: true }
    }
  }
  return {
    message: 'Couldn’t confirm whether this tool decision was applied. Retry safely or Dismiss.',
    retryable: true,
  }
}

const controller = createAcknowledgedActionMutationController<ToolActivityDecisionIntent, undefined>({
  resourceId: (intent) => `${intent.sessionId}\0${intent.activityId}`,
  snapshot: () => undefined,
  mutate: async (intent, idempotencyKey) => {
    rememberActivity(intent.sessionId, await applyToolActivityDecision(intent, idempotencyKey))
  },
  reconcile: async (intent, _baseline, idempotencyKey) => {
    const represented = await reconcileToolActivityDecision(intent, idempotencyKey)
    if (!represented) return false
    rememberActivity(intent.sessionId, represented)
    return true
  },
  describeFailure,
  setStatus: publishToolActivityDecisionStatus,
  mintIdempotencyKey: (intent) => intent.intentId,
})

export const enqueueToolActivityDecisionRuntime = controller.enqueue
export const retryToolActivityDecisionRuntime = controller.retry
export const discardToolActivityDecisionRuntime = controller.discard
export const clearToolActivityDecisions = controller.clearAll
