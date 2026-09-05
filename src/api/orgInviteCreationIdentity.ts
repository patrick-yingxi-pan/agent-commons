/** Browser twin of the server's durable owner-issued invitation identity. */
export async function orgInviteCreationId(
  orgId: string,
  ownerUserId: string,
  idempotencyKey: string,
): Promise<string> {
  const bytes = new TextEncoder().encode(`${orgId}\0${ownerUserId}\0${idempotencyKey}`)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  const suffix = [...digest]
    .slice(0, 12)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
  return `invite-new-${suffix}`
}
