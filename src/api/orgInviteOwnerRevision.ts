import type { InviteToOrgRequest, OrgInviteRow } from '../../contract/index.ts'

export interface OrgInviteIssueIntent {
  readonly kind: 'issue'
  readonly orgId: string
  readonly ownerUserId: string
  readonly request: InviteToOrgRequest
  readonly baselineInviteIds: readonly string[]
  readonly intentId: string
}

export interface OrgInviteRevokeIntent {
  readonly kind: 'revoke'
  readonly orgId: string
  readonly invitation: OrgInviteRow
  readonly intentId: string
}

export type OrgInviteOwnerIntent = OrgInviteIssueIntent | OrgInviteRevokeIntent

export const orgInviteOwnerResourceId = (intent: OrgInviteOwnerIntent): string =>
  intent.kind === 'issue'
    ? `org-invite-owner:issue:${intent.orgId}`
    : `org-invite-owner:revoke:${intent.invitation.id}`
