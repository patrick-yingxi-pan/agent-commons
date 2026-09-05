import {
  discardProjectSubGoalClaim,
  retryProjectSubGoalClaim,
  useProjectSubGoalClaimStatus,
} from '../controller/projectSubGoalClaimMutations.ts'
import { RevisionedMutationNotice } from './RevisionedMutationNotice.tsx'

export function ProjectSubGoalClaimMutationNotice() {
  const mutation = useProjectSubGoalClaimStatus()
  return (
    <RevisionedMutationNotice
      kind="subgoal-claim"
      mutation={mutation}
      pendingLabel="Claiming sub-goal…"
      onRetry={retryProjectSubGoalClaim}
      onDiscard={discardProjectSubGoalClaim}
    />
  )
}
