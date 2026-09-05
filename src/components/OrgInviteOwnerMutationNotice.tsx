import {
  discardOrgInviteOwnerAction,
  retryOrgInviteOwnerAction,
  useOrgInviteOwnerStatus,
} from '../controller/orgInviteOwnerMutations.ts'
import { RevisionedMutationNotice } from './RevisionedMutationNotice.tsx'

export function OrgInviteOwnerMutationNotice() {
  const mutation = useOrgInviteOwnerStatus()
  return (
    <RevisionedMutationNotice
      kind="org-invite-owner"
      mutation={mutation}
      pendingLabel="Updating organization invitations…"
      onRetry={retryOrgInviteOwnerAction}
      onDiscard={discardOrgInviteOwnerAction}
    />
  )
}
