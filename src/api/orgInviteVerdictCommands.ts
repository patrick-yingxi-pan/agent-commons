/** Transport and exact private-receipt reconciliation for invitation verdicts. */
import type { MyInvite, MyInviteReceipt, MyOrg, TenantRole } from '../../contract/index.ts'
import { apiGet, apiPost } from './client.ts'
import { invalidate, mutate, peek, revalidateAll, setData } from './cache.ts'
import { keys, paths } from './keys.ts'
import type { OrgInviteVerdictIntent } from './orgInviteVerdictRevision.ts'

const TENANT_ROLE_RANK: Record<TenantRole, number> = {
  member: 0,
  admin: 1,
  owner: 2,
}

function sameInvitation(left: MyInvite, right: MyInvite): boolean {
  return left.id === right.id &&
    left.orgId === right.orgId &&
    left.orgName === right.orgName &&
    left.role === right.role &&
    left.invitedBy === right.invitedBy &&
    left.at === right.at
}

function receiptInvitation(receipt: MyInviteReceipt): MyInvite {
  const { status: _status, resolvedAt: _resolvedAt, ...invitation } = receipt
  return invitation
}

function rememberInvitation(invitation: MyInvite, represented: boolean): void {
  if (!peek<MyInvite[]>(keys.meInvites)) return
  mutate<MyInvite[]>(keys.meInvites, (current) => {
    const rows = current ?? []
    const without = rows.filter((candidate) => candidate.id !== invitation.id)
    return represented ? [...without, invitation] : without
  })
}

function rememberMembership(membership: MyOrg): void {
  if (!peek<MyOrg[]>(keys.meOrgs)) return
  mutate<MyOrg[]>(keys.meOrgs, (current) => {
    const rows = current ?? []
    const without = rows.filter((candidate) => candidate.tenant.id !== membership.tenant.id)
    return [...without, membership]
  })
}

function exactMembership(intent: OrgInviteVerdictIntent, membership: MyOrg): boolean {
  return membership.tenant.id === intent.invitation.orgId &&
    membership.tenant.name === intent.invitation.orgName &&
    membership.tenant.kind === 'org' &&
    TENANT_ROLE_RANK[membership.role] >= TENANT_ROLE_RANK[intent.invitation.role]
}

export async function applyOrgInviteVerdict(
  intent: OrgInviteVerdictIntent,
  idempotencyKey: string,
): Promise<void> {
  if (intent.verdict === 'accept') {
    const membership = await apiPost<MyOrg>(
      paths.myInviteAccept(intent.invitation.id),
      undefined,
      { idempotencyKey },
    )
    if (!exactMembership(intent, membership)) {
      throw new Error('The server acknowledged a different organization invitation.')
    }
    rememberInvitation(intent.invitation, false)
    rememberMembership(membership)
    // A new seat widens every resource projection without changing identity.
    revalidateAll()
    return
  }
  const result = await apiPost<{ declined: true }>(
    paths.myInviteDecline(intent.invitation.id),
    undefined,
    { idempotencyKey },
  )
  if (result.declined !== true) {
    throw new Error('The server did not acknowledge this declined invitation.')
  }
  rememberInvitation(intent.invitation, false)
  invalidate(keys.meInvites)
}

/** Only the addressed invitation's durable terminal receipt can settle the
 * held decision. Accept additionally proves the exact represented org seat. */
export async function reconcileOrgInviteVerdict(
  intent: OrgInviteVerdictIntent,
): Promise<boolean> {
  const receipt = await apiGet<MyInviteReceipt>(paths.myInvite(intent.invitation.id))
  const invitation = receiptInvitation(receipt)
  if (!sameInvitation(invitation, intent.invitation)) return false
  rememberInvitation(invitation, receipt.status === 'invited')
  if (receipt.status !== (intent.verdict === 'accept' ? 'accepted' : 'declined')) {
    return false
  }
  if (intent.verdict === 'decline') {
    invalidate(keys.meInvites)
    return true
  }
  const incoming = await apiGet<MyOrg[]>(paths.meOrgs)
  const represented = incoming.find((membership) => exactMembership(intent, membership))
  if (!represented) return false
  if (peek<MyOrg[]>(keys.meOrgs)) rememberMembership(represented)
  else setData(keys.meOrgs, incoming)
  revalidateAll()
  return true
}
