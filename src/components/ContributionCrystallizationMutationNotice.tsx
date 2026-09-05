import {
  discardContributionCrystallization,
  retryContributionCrystallization,
  useContributionCrystallizationStatus,
} from '../controller/contributionCrystallizationMutations.ts'
import { RevisionedMutationNotice } from './RevisionedMutationNotice.tsx'

export function ContributionCrystallizationMutationNotice() {
  const mutation = useContributionCrystallizationStatus()
  return (
    <RevisionedMutationNotice
      kind="contribution-crystallization"
      mutation={mutation}
      pendingLabel="Crystallizing Contribution changes…"
      onRetry={retryContributionCrystallization}
      onDiscard={discardContributionCrystallization}
    />
  )
}
