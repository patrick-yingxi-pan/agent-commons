import { createHash } from 'node:crypto'

/** Durable public receipt identity for one conversation tool-consent verdict. */
const TOOL_ACTIVITY_DECISION_ID = /^tool-activity-decision-[a-f0-9]{24}$/

export function toolActivityDecisionId(
  tenantId: string,
  sessionId: string,
  activityId: string,
  idempotencyKey: string,
): string {
  const digest = createHash('sha256')
    .update(`${tenantId}\0${sessionId}\0${activityId}\0${idempotencyKey}`)
    .digest('hex')
    .slice(0, 24)
  return `tool-activity-decision-${digest}`
}

export const isToolActivityDecisionId = (id: string): boolean =>
  TOOL_ACTIVITY_DECISION_ID.test(id)
