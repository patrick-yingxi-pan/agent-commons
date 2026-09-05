import {
  discardContributionCommentCreation,
  retryContributionCommentCreation,
  useContributionCommentCreationStatus,
} from '../controller/contributionCommentCreationMutations.ts'
import { RevisionedMutationNotice } from './RevisionedMutationNotice.tsx'

export function ContributionCommentCreationMutationNotice() {
  const mutation = useContributionCommentCreationStatus()
  return (
    <RevisionedMutationNotice
      kind="contribution-comment-create"
      mutation={mutation}
      pendingLabel="Posting Contribution comment…"
      onRetry={retryContributionCommentCreation}
      onDiscard={discardContributionCommentCreation}
    />
  )
}
