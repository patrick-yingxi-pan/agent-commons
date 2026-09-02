/** Browser-side projection of the server's tenant-scoped social-post id. */
export async function discussionPostId(tenantId: string, idempotencyKey: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${tenantId}\0${idempotencyKey}`)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `dpost-new-${hex.slice(0, 24)}`
}
