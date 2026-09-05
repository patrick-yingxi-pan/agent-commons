import { createHash } from 'node:crypto'

/** Durable public receipt identity for one conversation relation decision. */
const RELATION_ACTION_DECISION_ID = /^relation-action-decision-[a-f0-9]{24}$/

export function relationActionDecisionId(
  tenantId: string,
  sessionId: string,
  messageId: string,
  operationKey: string,
  idempotencyKey: string,
): string {
  const digest = createHash('sha256')
    .update(`${tenantId}\0${sessionId}\0${messageId}\0${operationKey}\0${idempotencyKey}`)
    .digest('hex')
    .slice(0, 24)
  return `relation-action-decision-${digest}`
}

export const isRelationActionDecisionId = (id: string): boolean =>
  RELATION_ACTION_DECISION_ID.test(id)
