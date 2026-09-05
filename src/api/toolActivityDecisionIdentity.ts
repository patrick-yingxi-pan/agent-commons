/** Browser twin of the server's durable conversation tool-consent receipt. */
export async function toolActivityDecisionId(
  tenantId: string,
  sessionId: string,
  activityId: string,
  idempotencyKey: string,
): Promise<string> {
  const bytes = new TextEncoder().encode(`${tenantId}\0${sessionId}\0${activityId}\0${idempotencyKey}`)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return `tool-activity-decision-${[...digest].slice(0, 12).map((byte) => byte.toString(16).padStart(2, '0')).join('')}`
}
