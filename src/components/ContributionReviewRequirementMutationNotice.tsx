import {
  discardContributionReviewRequirement,
  retryContributionReviewRequirement,
  useContributionReviewRequirementStatus,
} from '../controller/contributionReviewRequirementMutations.ts'
import { RevisionedMutationNotice } from './RevisionedMutationNotice.tsx'

export function ContributionReviewRequirementMutationNotice() {
  const mutation = useContributionReviewRequirementStatus()
  return (
    <RevisionedMutationNotice
      kind="contribution-require-review"
      mutation={mutation}
      pendingLabel="Requiring Contribution review…"
      onRetry={retryContributionReviewRequirement}
      onDiscard={discardContributionReviewRequirement}
    />
  )
}
