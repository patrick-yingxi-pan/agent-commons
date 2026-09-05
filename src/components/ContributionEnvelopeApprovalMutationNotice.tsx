import {
  discardContributionEnvelopeApproval,
  retryContributionEnvelopeApproval,
  useContributionEnvelopeApprovalStatus,
} from '../controller/contributionEnvelopeApprovalMutations.ts'
import { RevisionedMutationNotice } from './RevisionedMutationNotice.tsx'

export function ContributionEnvelopeApprovalMutationNotice() {
  const mutation = useContributionEnvelopeApprovalStatus()
  return (
    <RevisionedMutationNotice
      kind="contribution-envelope-approval"
      mutation={mutation}
      pendingLabel="Approving effect envelope…"
      onRetry={retryContributionEnvelopeApproval}
      onDiscard={discardContributionEnvelopeApproval}
    />
  )
}
