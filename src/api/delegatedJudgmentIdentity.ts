/** Browser twin of the server's durable delegated-judgment receipt. */
export async function delegatedJudgmentId(
  tenantId: string,
  projectId: string,
  contributionId: string,
  delegationId: string,
  idempotencyKey: string,
): Promise<string> {
  const bytes = new TextEncoder().encode(
    `${tenantId}\0${projectId}\0${contributionId}\0${delegationId}\0${idempotencyKey}`,
  )
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return `delegated-judgment-${[...digest].slice(0, 12).map((byte) => byte.toString(16).padStart(2, '0')).join('')}`
}
