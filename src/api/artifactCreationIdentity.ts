/** Browser twin of the server's durable direct-creation identity. Display names,
 * formats, and filing are content, never a substitute for this request key. */
export async function artifactCreationId(tenantId: string, idempotencyKey: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${tenantId}\0${idempotencyKey}`)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  const suffix = [...digest].slice(0, 12).map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `artifact-new-${suffix}`
}
