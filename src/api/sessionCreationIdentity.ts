async function opaqueSessionId(
  prefix: 'new' | 'fork',
  tenantId: string,
  idempotencyKey: string,
): Promise<string> {
  const bytes = new TextEncoder().encode(`${tenantId}\0${idempotencyKey}`)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  const suffix = [...digest].slice(0, 12).map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `sess-${prefix}-${suffix}`
}

/** Browser-side projection of the server's tenant-scoped opaque Session ids. */
export function sessionCreationId(tenantId: string, idempotencyKey: string): Promise<string> {
  return opaqueSessionId('new', tenantId, idempotencyKey)
}

export function sessionForkCreationId(tenantId: string, idempotencyKey: string): Promise<string> {
  return opaqueSessionId('fork', tenantId, idempotencyKey)
}
