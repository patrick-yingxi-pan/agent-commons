import { createHash } from 'node:crypto'

const ORG_INVITE_CREATION_ID = /^invite-new-[a-f0-9]{24}$/

/** Durable identity for one owner-issued organization invitation. Actor and
 * organization scope keep a reused transport key from aliasing another owner
 * or ledger, while the raw key never enters persisted state. */
export function orgInviteCreationId(
  orgId: string,
  ownerUserId: string,
  idempotencyKey: string,
): string {
  const digest = createHash('sha256')
    .update(`${orgId}\0${ownerUserId}\0${idempotencyKey}`)
    .digest('hex')
    .slice(0, 24)
  return `invite-new-${digest}`
}

export const isOrgInviteCreationId = (id: string): boolean =>
  ORG_INVITE_CREATION_ID.test(id)

/** Stable routing audience for an addressed email. It is emitted for known and
 * unknown addresses alike, so live delivery cannot become an account oracle. */
export function orgInviteAddressAudience(email: string): string {
  const digest = createHash('sha256')
    .update(`org-invite-address\0${email.trim().toLowerCase()}`)
    .digest('hex')
    .slice(0, 24)
  return `address-audience-${digest}`
}
