import {
  discardSocialProposalCreation,
  retrySocialProposalCreation,
  useSocialProposalCreationStatus,
} from '../controller/socialProposalCreationMutations.ts'
import { RevisionedMutationNotice } from './RevisionedMutationNotice.tsx'

export function SocialProposalCreationMutationNotice() {
  const mutation = useSocialProposalCreationStatus()
  return (
    <RevisionedMutationNotice
      kind="social-proposal-create"
      mutation={mutation}
      pendingLabel="Offering change…"
      onRetry={retrySocialProposalCreation}
      onDiscard={discardSocialProposalCreation}
    />
  )
}
