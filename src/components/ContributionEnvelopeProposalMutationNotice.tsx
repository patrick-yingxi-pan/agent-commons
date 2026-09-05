import {
  discardContributionEnvelopeProposal,
  retryContributionEnvelopeProposal,
  useContributionEnvelopeProposalStatus,
} from '../controller/contributionEnvelopeProposalMutations.ts'
import { RevisionedMutationNotice } from './RevisionedMutationNotice.tsx'

export function ContributionEnvelopeProposalMutationNotice() {
  const mutation = useContributionEnvelopeProposalStatus()
  return (
    <RevisionedMutationNotice
      kind="contribution-envelope-proposal"
      mutation={mutation}
      pendingLabel="Proposing effect envelope…"
      onRetry={retryContributionEnvelopeProposal}
      onDiscard={discardContributionEnvelopeProposal}
    />
  )
}
