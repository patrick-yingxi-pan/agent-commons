/** Browser twin of the server's durable relation-proposal decision receipt. */
export async function relationActionDecisionId(
  tenantId: string,
  sessionId: string,
  messageId: string,
  operationKey: string,
  idempotencyKey: string,
): Promise<string> {
  const bytes = new TextEncoder().encode(
    `${tenantId}\0${sessionId}\0${messageId}\0${operationKey}\0${idempotencyKey}`,
  )
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return `relation-action-decision-${[...digest].slice(0, 12).map((byte) => byte.toString(16).padStart(2, '0')).join('')}`
}
