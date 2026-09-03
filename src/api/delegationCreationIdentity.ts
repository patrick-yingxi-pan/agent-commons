/** Browser twin of the server's durable Delegation creation identity. */
export async function delegationCreationId(
  tenantId: string,
  projectId: string,
  idempotencyKey: string,
): Promise<string> {
  const bytes = new TextEncoder().encode(`${tenantId}\0${projectId}\0${idempotencyKey}`)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return `delegation-new-${[...digest].slice(0, 12).map((byte) => byte.toString(16).padStart(2, '0')).join('')}`
}
