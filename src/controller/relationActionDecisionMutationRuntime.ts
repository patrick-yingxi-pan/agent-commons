/** Lazy acknowledgement controller behind model-proposed relation decisions. */
import { AccountSwitchedError, ApiRequestError, invalidate, keys, reconcileRelationOp } from '../api'
import {
  applyRelationActionDecision,
  reconcileRelationActionDecision,
  type RelationActionDecisionIntent,
} from '../api/relationActionDecisionCommands.ts'
import { addContextToLive, focusForAdded } from '../data/liveSession.ts'
import { createAcknowledgedActionMutationController } from './acknowledgedActionMutationCore.ts'
import { conversations } from './conversationStore.ts'
import { rememberPanelPreference } from './panelPreferences.ts'
import { publishRelationActionDecisionStatus } from './relationActionDecisionMutations.ts'
import type { RevisionedMutationFailure } from './revisionedMutationCore.ts'

/** Merge only the addressed message fields and additive attached connector.
 * Delayed acknowledgement must not replace newer turns or other context. */
function rememberDecision(intent: RelationActionDecisionIntent, decisionId: string): void {
  const added = intent.verdict === 'confirmed' && intent.operation.kind === 'attach-context'
    ? {
        kind: intent.operation.connectorKind === 'mcp' ? 'mcp' as const : 'connector' as const,
        connector: {
          id: intent.operation.connectorId,
          label: intent.operation.connectorLabel,
          kind: intent.operation.connectorKind,
        },
      }
    : undefined
  conversations.setLive(intent.sessionId, (current) => {
    const withDecision = {
      ...current,
      messages: current.messages.map((message) => message.id === intent.messageId
        ? {
            ...message,
            relationsResolved: { ...message.relationsResolved, [intent.operationKey]: intent.verdict },
            relationDecisionIds: { ...message.relationDecisionIds, [intent.operationKey]: decisionId },
          }
        : message),
    }
    return added ? addContextToLive(withDecision, added) : withDecision
  })
  if (added) {
    const live = conversations.get(intent.sessionId).live
    const focus = focusForAdded(added, live)
    if (focus) {
      conversations.setFocus(intent.sessionId, focus)
      rememberPanelPreference(intent.sessionId, focus)
    }
    invalidate(keys.sessionContexts(intent.sessionId))
  } else if (intent.verdict === 'confirmed') {
    // The route already committed. Projection recovery is advisory and must not
    // turn an acknowledged consent action into a false transport failure.
    void reconcileRelationOp(intent.operation).catch(() => {})
  }
}

function describeFailure(error: unknown): RevisionedMutationFailure {
  if (error instanceof AccountSwitchedError) {
    return { message: 'That proposed-change decision belonged to the previous account. Dismiss it to continue.', retryable: false }
  }
  if (error instanceof ApiRequestError) {
    if (error.status === 400 || error.status === 404) {
      return { message: 'This exact proposed change can no longer be decided. Dismiss it and review the current conversation.', retryable: false }
    }
    if (error.status === 401 || error.status === 403) {
      return { message: 'You no longer have permission to decide this proposed change. Dismiss it to continue.', retryable: false }
    }
    if (error.status === 409) {
      return { message: `${error.message} Retry safely, or Dismiss to review current state.`, retryable: true }
    }
    if (error.status === 429) {
      return { message: 'Proposed changes are temporarily rate-limited. Retry shortly.', retryable: true }
    }
  }
  return {
    message: 'Couldn’t confirm whether this proposed-change decision was applied. Retry safely or Dismiss.',
    retryable: true,
  }
}

const controller = createAcknowledgedActionMutationController<RelationActionDecisionIntent, undefined>({
  resourceId: (intent) => `${intent.sessionId}\0${intent.messageId}\0${intent.operationKey}`,
  snapshot: () => undefined,
  mutate: async (intent, idempotencyKey) => {
    const response = await applyRelationActionDecision(intent, idempotencyKey)
    rememberDecision(intent, response.decisionId!)
  },
  reconcile: async (intent, _baseline, idempotencyKey) => {
    const response = await reconcileRelationActionDecision(intent, idempotencyKey)
    if (!response?.decisionId) return false
    rememberDecision(intent, response.decisionId)
    return true
  },
  describeFailure,
  setStatus: publishRelationActionDecisionStatus,
  mintIdempotencyKey: (intent) => intent.intentId,
})

export const enqueueRelationActionDecisionRuntime = controller.enqueue
export const retryRelationActionDecisionRuntime = controller.retry
export const discardRelationActionDecisionRuntime = controller.discard
export const clearRelationActionDecisions = controller.clearAll
