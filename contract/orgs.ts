/** ── Contract: organizations (FWD-6 — orgs as namespaces, never worlds) ──────
 *  An org is an owner NAMESPACE with members: it owns entities, has the D21
 *  profile page, and never acts, logs in, or gets "entered" (no switching —
 *  design docs/design/principals-and-namespaces.md §8). Membership arrives only
 *  through a CONSENT act: an email-keyed, existence-hidden invitation the
 *  invitee accepts (O-D3). */
import type { Tenant, TenantRole } from './identity.ts'

/** One of the caller's org memberships — `GET /v1/me/orgs`. The caller's person
 *  namespace is deliberately NOT in this list (it isn't an org seat). */
export interface MyOrg {
  tenant: Tenant
  role: TenantRole
}

export type OrgInviteStatus = 'invited' | 'accepted' | 'declined' | 'revoked'

/** An invitation as the ORG side sees it — `GET /v1/orgs/:id/invites`,
 *  owner-only (the email is what the owner typed; the row never says whether an
 *  account bears it — existence-hiding, O-D3). Lifecycle: `invited` →
 *  `accepted` | `declined` (the invitee's verdicts) | `revoked` (the owner's). */
export interface OrgInviteRow {
  id: string
  email: string
  role: TenantRole
  /** The inviting user's display name (public identity). */
  invitedBy: string
  at: number
  status: OrgInviteStatus
  resolvedAt?: number
}

/** An invitation as the INVITEE sees it — `GET /v1/me/invites` (pending invites
 *  addressed to the signed-in account's email). Carries the org's display name
 *  so the row renders as a door; the email is the caller's own. */
export interface MyInvite {
  id: string
  orgId: string
  orgName: string
  role: TenantRole
  invitedBy: string
  at: number
}

/** The invitee's private recovery view for one addressed invitation. Revoked
 * rows stay existence-hidden; accepted/declined receipts survive removal from
 * the pending list so an ambiguous verdict response can be settled exactly. */
export interface MyInviteReceipt extends MyInvite {
  status: 'invited' | 'accepted' | 'declined'
  resolvedAt?: number
}

/** One member row (`GET /v1/orgs/:id/members` — any seat may read; the display
 *  name is the public identity, the same face every byline shows). */
export interface OrgMemberRow {
  name: string
  role: TenantRole
}

/** Body of `POST /v1/orgs` — found an org; the caller becomes its `owner`.
 * A supplied transport idempotency key durably identifies that one founding;
 * omission retains compatibility best-effort creation. */
export interface CreateOrgRequest {
  name: string
}

/** Body of `POST /v1/orgs/:id/invites` (owner-only). The response is uniform
 * whether or not an account bears the email (O-D3). A supplied transport key
 * durably identifies one issue; omission retains compatibility behavior. */
export interface InviteToOrgRequest {
  email: string
}
