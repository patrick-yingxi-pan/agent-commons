/** Browser-side projection of the server's tenant-scoped opaque Dispatch id. */
export async function manualDispatchRunId(tenantId: string, idempotencyKey: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${tenantId}\0${idempotencyKey}`)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `d-new-${hex.slice(0, 24)}`
}
