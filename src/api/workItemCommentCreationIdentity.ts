/** Browser twin of the server's durable work-item comment identity. */
export async function workItemCommentCreationId(
  tenantId: string,
  projectId: string,
  itemId: string,
  idempotencyKey: string,
): Promise<string> {
  const bytes = new TextEncoder().encode(`${tenantId}\0${projectId}\0${itemId}\0${idempotencyKey}`)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return `work-comment-new-${[...digest].slice(0, 12).map((byte) => byte.toString(16).padStart(2, '0')).join('')}`
}
