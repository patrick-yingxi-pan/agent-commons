/** Transport and exact reconciliation for conversation tool-consent verdicts. */
import type {
  ResolveToolActivityRequest,
  Session,
  ToolActivity,
} from '../../contract/index.ts'
import { apiGet, apiPost } from './client.ts'
import { invalidate } from './cache.ts'
import { keys, paths } from './keys.ts'
import { toolActivityDecisionId } from './toolActivityDecisionIdentity.ts'

export type ToolActivityDecision = ResolveToolActivityRequest['decision']

export interface ToolActivityDecisionIntent {
  readonly intentId: string
  readonly tenantId: string
  readonly sessionId: string
  readonly activityId: string
  readonly decision: ToolActivityDecision
}

const expectedStatus = (decision: ToolActivityDecision): ToolActivity['status'] =>
  decision === 'confirm' ? 'done' : 'declined'

const exactDecision = (
  activity: ToolActivity,
  intent: ToolActivityDecisionIntent,
  expectedId: string,
): boolean => activity.id === intent.activityId &&
  activity.kind === 'action' &&
  activity.decisionId === expectedId &&
  activity.status === expectedStatus(intent.decision)

const rememberDecision = (sessionId: string): void => {
  // The conversation controller, not the query cache, merges the addressed
  // activity. This invalidation gives a later reopen authoritative transcript.
  invalidate(keys.session(sessionId))
}

export async function applyToolActivityDecision(
  intent: ToolActivityDecisionIntent,
  idempotencyKey: string,
): Promise<ToolActivity> {
  const expectedId = await toolActivityDecisionId(
    intent.tenantId,
    intent.sessionId,
    intent.activityId,
    idempotencyKey,
  )
  const activity = await apiPost<ToolActivity>(
    paths.toolActivity(intent.sessionId, intent.activityId),
    { decision: intent.decision } satisfies ResolveToolActivityRequest,
    { idempotencyKey },
  )
  if (!exactDecision(activity, intent, expectedId)) {
    throw new Error('The tool decision acknowledgement did not match the exact consent action.')
  }
  rememberDecision(intent.sessionId)
  return activity
}

export async function reconcileToolActivityDecision(
  intent: ToolActivityDecisionIntent,
  idempotencyKey: string,
): Promise<ToolActivity | undefined> {
  const expectedId = await toolActivityDecisionId(
    intent.tenantId,
    intent.sessionId,
    intent.activityId,
    idempotencyKey,
  )
  // Recovery is deliberately unpaged: an unresolved consent card may be older
  // than the open conversation tail, while its exact activity id stays unique.
  const session = await apiGet<Session>(paths.session(intent.sessionId))
  const activity = (session.messages ?? [])
    .flatMap((message) => message.toolActivities ?? [])
    .find((candidate) => candidate.id === intent.activityId)
  if (!activity || !exactDecision(activity, intent, expectedId)) return undefined
  rememberDecision(intent.sessionId)
  return activity
}
