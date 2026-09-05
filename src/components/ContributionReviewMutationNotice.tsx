import {
  discardContributionReview,
  retryContributionReview,
  useContributionReviewStatus,
} from '../controller/contributionReviewMutations.ts'
import { RevisionedMutationNotice } from './RevisionedMutationNotice.tsx'

export function ContributionReviewMutationNotice() {
  const mutation = useContributionReviewStatus()
  return (
    <RevisionedMutationNotice
      kind="contribution-review"
      mutation={mutation}
      pendingLabel="Reviewing Contribution changeset…"
      onRetry={retryContributionReview}
      onDiscard={discardContributionReview}
    />
  )
}
