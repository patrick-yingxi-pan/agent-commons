import type { MyInvite } from '../../contract/index.ts'

export type OrgInviteVerdict = 'accept' | 'decline'

/** One immutable invitation decision as reviewed in the account menu. */
export interface OrgInviteVerdictIntent {
  readonly invitation: MyInvite
  readonly verdict: OrgInviteVerdict
  readonly intentId: string
}

export const orgInviteVerdictResourceId = (intent: OrgInviteVerdictIntent): string =>
  `org-invite-verdict:${intent.invitation.id}`
