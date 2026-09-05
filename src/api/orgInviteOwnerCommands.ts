/** Transport and exact ledger reconciliation for owner invitation actions. */
import type { OrgInviteRow } from '../../contract/index.ts'
import { apiDelete, apiGet, apiPost } from './client.ts'
import { invalidate, mutate, peek, setData } from './cache.ts'
import { keys, paths } from './keys.ts'
import { orgInviteCreationId } from './orgInviteCreationIdentity.ts'
import type {
  OrgInviteIssueIntent,
  OrgInviteOwnerIntent,
  OrgInviteRevokeIntent,
} from './orgInviteOwnerRevision.ts'

const normalizedEmail = (email: string): string => email.trim().toLowerCase()

function sameInvitation(left: OrgInviteRow, right: OrgInviteRow): boolean {
  return left.id === right.id &&
    normalizedEmail(left.email) === normalizedEmail(right.email) &&
    left.role === right.role &&
    left.invitedBy === right.invitedBy &&
    left.at === right.at
}

function validIssuedRow(row: OrgInviteRow, email: string): boolean {
  return normalizedEmail(row.email) === normalizedEmail(email) && row.role === 'member'
}

function rememberInvitation(orgId: string, invitation: OrgInviteRow): void {
  const key = keys.orgInvites(orgId)
  if (!peek<OrgInviteRow[]>(key)) return
  mutate<OrgInviteRow[]>(key, (current) => {
    const rows = current ?? []
    return rows.some((candidate) => candidate.id === invitation.id)
      ? rows.map((candidate) => candidate.id === invitation.id ? invitation : candidate)
      : [...rows, invitation]
  })
}

async function applyIssue(intent: OrgInviteIssueIntent, idempotencyKey: string): Promise<void> {
  const expectedId = await orgInviteCreationId(intent.orgId, intent.ownerUserId, idempotencyKey)
  const invitation = await apiPost<OrgInviteRow>(
    paths.orgInvites(intent.orgId),
    intent.request,
    { idempotencyKey },
  )
  if (invitation.id !== expectedId || !validIssuedRow(invitation, intent.request.email)) {
    throw new Error('The server acknowledged a different organization invitation.')
  }
  rememberInvitation(intent.orgId, invitation)
  invalidate(keys.orgInvites(intent.orgId))
}

async function applyRevoke(intent: OrgInviteRevokeIntent, idempotencyKey: string): Promise<void> {
  const invitation = await apiDelete<OrgInviteRow>(
    paths.orgInvite(intent.orgId, intent.invitation.id),
    undefined,
    { idempotencyKey },
  )
  if (!sameInvitation(invitation, intent.invitation) || invitation.status !== 'revoked') {
    throw new Error('The server acknowledged a different invitation revocation.')
  }
  rememberInvitation(intent.orgId, invitation)
  invalidate(keys.orgInvites(intent.orgId))
}

export async function applyOrgInviteOwnerAction(
  intent: OrgInviteOwnerIntent,
  idempotencyKey: string,
): Promise<void> {
  return intent.kind === 'issue'
    ? applyIssue(intent, idempotencyKey)
    : applyRevoke(intent, idempotencyKey)
}

async function reconcileIssue(intent: OrgInviteIssueIntent, incoming: OrgInviteRow[]): Promise<boolean> {
  const expectedId = await orgInviteCreationId(intent.orgId, intent.ownerUserId, intent.intentId)
  const represented = incoming.find((invitation) =>
    validIssuedRow(invitation, intent.request.email) &&
    (invitation.id === expectedId || !intent.baselineInviteIds.includes(invitation.id)),
  )
  if (!represented) return false
  rememberInvitation(intent.orgId, represented)
  return true
}

function reconcileRevoke(intent: OrgInviteRevokeIntent, incoming: OrgInviteRow[]): boolean {
  const represented = incoming.find((invitation) => sameInvitation(invitation, intent.invitation))
  if (represented) rememberInvitation(intent.orgId, represented)
  return represented?.status === 'revoked'
}

/** A full owner ledger read supplies exact truth. Loaded caches merge only the
 * addressed row so a crossed read cannot erase a newer unrelated invitation. */
export async function reconcileOrgInviteOwnerAction(
  intent: OrgInviteOwnerIntent,
): Promise<boolean> {
  const key = keys.orgInvites(intent.orgId)
  const incoming = await apiGet<OrgInviteRow[]>(paths.orgInvites(intent.orgId))
  const hadCache = peek<OrgInviteRow[]>(key) !== undefined
  if (!hadCache) setData(key, incoming)
  const realized = intent.kind === 'issue'
    ? await reconcileIssue(intent, incoming)
    : reconcileRevoke(intent, incoming)
  invalidate(key)
  return realized
}
