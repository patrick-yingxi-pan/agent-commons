/** Transport and exact reconciliation for conversation tool-consent verdicts. */
import type {
  ResolveToolActivityRequest,
  Session,
  ToolActivity,
} from '../../contract/index.ts'
import { AccountSwitchedError, apiGet, apiPost } from './client.ts'
import { accountGeneration, activeAccount } from './account.ts'
import { invalidate } from './cache.ts'
import { keys, paths } from './keys.ts'
import { toolActivityDecisionId } from './toolActivityDecisionIdentity.ts'

export type ToolActivityDecision = ResolveToolActivityRequest['decision']

export interface ToolActivityDecisionIntent {
  readonly intentId: string
  readonly tenantId: string
  readonly sourceUserId: string | null
  readonly sessionId: string
  readonly activityId: string
  readonly decision: ToolActivityDecision
}

function assertScope(intent: ToolActivityDecisionIntent, issuedGeneration: number): void {
  const account = activeAccount()
  if (issuedGeneration !== accountGeneration() || (account && account.tenantId !== intent.tenantId)) {
    throw new AccountSwitchedError('tool decision identity changed')
  }
}

const confirmedMcpStatuses: readonly ToolActivity['status'][] = ['running', 'done', 'failed', 'uncertain']

const expectedDecisionStatus = (
  activity: ToolActivity,
  decision: ToolActivityDecision,
): boolean => decision === 'decline'
  ? activity.status === 'declined'
  : activity.mcp !== undefined
    ? confirmedMcpStatuses.includes(activity.status)
    : activity.status === 'done'

const exactDecision = (
  activity: ToolActivity,
  intent: ToolActivityDecisionIntent,
  expectedId: string,
): boolean => activity.id === intent.activityId &&
  activity.kind === 'action' &&
  activity.decisionId === expectedId &&
  expectedDecisionStatus(activity, intent.decision)

const rememberDecision = (sessionId: string): void => {
  // The conversation controller, not the query cache, merges the addressed
  // activity. This invalidation gives a later reopen authoritative transcript.
  invalidate(keys.session(sessionId))
}

export async function applyToolActivityDecision(
  intent: ToolActivityDecisionIntent,
  idempotencyKey: string,
): Promise<ToolActivity> {
  const issuedGeneration = accountGeneration()
  const expectedId = await toolActivityDecisionId(
    intent.tenantId,
    intent.sessionId,
    intent.activityId,
    idempotencyKey,
  )
  assertScope(intent, issuedGeneration)
  const activity = await apiPost<ToolActivity>(
    paths.toolActivity(intent.sessionId, intent.activityId),
    { decision: intent.decision } satisfies ResolveToolActivityRequest,
    { idempotencyKey, expectedSessionUserId: intent.sourceUserId },
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
  const issuedGeneration = accountGeneration()
  const expectedId = await toolActivityDecisionId(
    intent.tenantId,
    intent.sessionId,
    intent.activityId,
    idempotencyKey,
  )
  assertScope(intent, issuedGeneration)
  // Recovery is deliberately unpaged: an exact activity + decision receipt may
  // be older than the open tail and must win over a later reused activity id.
  const session = await apiGet<Session>(paths.session(intent.sessionId))
  const candidates = [
    ...(session.messages ?? []).flatMap((message) => message.toolActivities ?? []),
    ...(session.compactedMessages ?? []).flatMap((message) => message.toolActivities ?? [])
      .filter((candidate) => candidate.mcp !== undefined &&
        (candidate.status === 'done' || candidate.status === 'failed' ||
          candidate.status === 'uncertain' || candidate.status === 'declined')),
  ].filter((activity) => exactDecision(activity, intent, expectedId))
  if (candidates.length !== 1) return undefined
  const activity = candidates[0]!
  rememberDecision(intent.sessionId)
  return activity
}
