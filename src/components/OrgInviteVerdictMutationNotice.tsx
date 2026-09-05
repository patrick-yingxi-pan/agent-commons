import {
  discardOrgInviteVerdict,
  retryOrgInviteVerdict,
  useOrgInviteVerdictStatus,
} from '../controller/orgInviteVerdictMutations.ts'
import { RevisionedMutationNotice } from './RevisionedMutationNotice.tsx'

export function OrgInviteVerdictMutationNotice() {
  const mutation = useOrgInviteVerdictStatus()
  return (
    <RevisionedMutationNotice
      kind="org-invite-verdict"
      mutation={mutation}
      pendingLabel="Updating organization invitation…"
      onRetry={retryOrgInviteVerdict}
      onDiscard={discardOrgInviteVerdict}
    />
  )
}
