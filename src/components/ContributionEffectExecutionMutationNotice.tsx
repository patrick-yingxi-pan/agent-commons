import {
  discardContributionEffectExecution,
  retryContributionEffectExecution,
  useContributionEffectExecutionStatus,
} from '../controller/contributionEffectExecutionMutations.ts'
import { RevisionedMutationNotice } from './RevisionedMutationNotice.tsx'

export function ContributionEffectExecutionMutationNotice() {
  const mutation = useContributionEffectExecutionStatus()
  return (
    <RevisionedMutationNotice
      kind="contribution-effect"
      mutation={mutation}
      pendingLabel="Running approved effect…"
      onRetry={retryContributionEffectExecution}
      onDiscard={discardContributionEffectExecution}
    />
  )
}
