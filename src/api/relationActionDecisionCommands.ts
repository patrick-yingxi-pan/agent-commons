/** Transport and exact reconciliation for model-proposed relation decisions. */
import type {
  RelationOp,
  ResolveMessageRelationRequest,
  ResolveMessageRelationResponse,
  Session,
} from '../../contract/index.ts'
import { opKey } from '../../contract/index.ts'
import { apiGet, apiPost } from './client.ts'
import { invalidate } from './cache.ts'
import { keys, paths } from './keys.ts'
import { relationActionDecisionId } from './relationActionDecisionIdentity.ts'

export type RelationActionVerdict = ResolveMessageRelationRequest['verdict']

export interface RelationActionDecisionIntent {
  readonly intentId: string
  readonly tenantId: string
  readonly sessionId: string
  readonly messageId: string
  readonly operation: RelationOp
  readonly operationKey: string
  readonly verdict: RelationActionVerdict
}

const exactResponse = (
  response: ResolveMessageRelationResponse,
  intent: RelationActionDecisionIntent,
  expectedId: string,
): boolean => response.key === intent.operationKey &&
  response.verdict === intent.verdict &&
  response.decisionId === expectedId

const exactSessionDecision = (
  session: Session,
  intent: RelationActionDecisionIntent,
  expectedId: string,
): ResolveMessageRelationResponse | undefined => {
  const message = session.messages?.find((candidate) => candidate.id === intent.messageId)
  if (!message || !(message.relationActions ?? []).some((operation) => opKey(operation) === intent.operationKey)) {
    return undefined
  }
  if (
    message.relationsResolved?.[intent.operationKey] !== intent.verdict ||
    message.relationDecisionIds?.[intent.operationKey] !== expectedId
  ) {
    return undefined
  }
  return { key: intent.operationKey, verdict: intent.verdict, decisionId: expectedId }
}

function invalidateDecision(intent: RelationActionDecisionIntent): void {
  invalidate(keys.session(intent.sessionId))
  if (intent.verdict !== 'confirmed') return
  if (intent.operation.kind === 'attach-context') invalidate(keys.sessionContexts(intent.sessionId))
  else invalidate(keys.relations)
}

export async function applyRelationActionDecision(
  intent: RelationActionDecisionIntent,
  idempotencyKey: string,
): Promise<ResolveMessageRelationResponse> {
  const expectedId = await relationActionDecisionId(
    intent.tenantId,
    intent.sessionId,
    intent.messageId,
    intent.operationKey,
    idempotencyKey,
  )
  const response = await apiPost<ResolveMessageRelationResponse>(
    paths.messageRelations(intent.sessionId, intent.messageId),
    { key: intent.operationKey, verdict: intent.verdict } satisfies ResolveMessageRelationRequest,
    { idempotencyKey },
  )
  if (!exactResponse(response, intent, expectedId)) {
    throw new Error('The proposed-change acknowledgement did not match the exact consent action.')
  }
  invalidateDecision(intent)
  return response
}

export async function reconcileRelationActionDecision(
  intent: RelationActionDecisionIntent,
  idempotencyKey: string,
): Promise<ResolveMessageRelationResponse | undefined> {
  const expectedId = await relationActionDecisionId(
    intent.tenantId,
    intent.sessionId,
    intent.messageId,
    intent.operationKey,
    idempotencyKey,
  )
  // Recovery is unpaged because a held proposal may have moved beyond the
  // browser's bounded transcript tail while its containing Session remains the
  // durable authority.
  const session = await apiGet<Session>(paths.session(intent.sessionId))
  const response = exactSessionDecision(session, intent, expectedId)
  if (response) invalidateDecision(intent)
  return response
}
