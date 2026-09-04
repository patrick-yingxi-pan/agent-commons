/** Browser-side projection of the server's tenant-scoped opaque Session id. */
export async function sessionCreationId(tenantId: string, idempotencyKey: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${tenantId}\0${idempotencyKey}`)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return `sess-new-${[...digest].slice(0, 12).map((byte) => byte.toString(16).padStart(2, '0')).join('')}`
}
