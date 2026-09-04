import {
  discardProjectSubGoalRelease,
  retryProjectSubGoalRelease,
  useProjectSubGoalReleaseStatus,
} from '../controller/projectSubGoalReleaseMutations.ts'
import { RevisionedMutationNotice } from './RevisionedMutationNotice.tsx'

export function ProjectSubGoalReleaseMutationNotice() {
  const mutation = useProjectSubGoalReleaseStatus()
  return (
    <RevisionedMutationNotice
      kind="subgoal-release"
      mutation={mutation}
      pendingLabel="Releasing claim…"
      onRetry={retryProjectSubGoalRelease}
      onDiscard={discardProjectSubGoalRelease}
    />
  )
}
