import {
  discardContributionCreation,
  retryContributionCreation,
  useContributionCreationStatus,
} from '../controller/contributionCreationMutations.ts'
import { RevisionedMutationNotice } from './RevisionedMutationNotice.tsx'

export function ContributionCreationMutationNotice() {
  const mutation = useContributionCreationStatus()
  return (
    <RevisionedMutationNotice
      kind="contribution-create"
      mutation={mutation}
      pendingLabel="Declaring Contribution…"
      onRetry={retryContributionCreation}
      onDiscard={discardContributionCreation}
    />
  )
}
