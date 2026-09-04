import {
  discardContributionLanding,
  retryContributionLanding,
  useContributionLandingStatus,
} from '../controller/contributionLandingMutations.ts'
import { RevisionedMutationNotice } from './RevisionedMutationNotice.tsx'

export function ContributionLandingMutationNotice() {
  const mutation = useContributionLandingStatus()
  return (
    <RevisionedMutationNotice
      kind="contribution-land"
      mutation={mutation}
      pendingLabel="Landing Contribution…"
      onRetry={retryContributionLanding}
      onDiscard={discardContributionLanding}
    />
  )
}
