import {
  discardScheduleMutation,
  retryScheduleMutation,
  useScheduleMutationStatus,
} from '../controller/scheduleMutations'
import {
  discardScheduleDeletion,
  retryScheduleDeletion,
  useScheduleDeletionStatus,
} from '../controller/scheduleDeletionMutations'
import {
  discardScheduleRun,
  retryScheduleRun,
  useScheduleRunStatus,
} from '../controller/scheduleRunMutations'
import {
  discardScheduleCreation,
  retryScheduleCreation,
  useScheduleCreationStatus,
} from '../controller/scheduleCreationMutations'
import { RevisionedMutationNotice } from './RevisionedMutationNotice'

/** One shell owner for routine definition, execution, and deletion recovery. */
export function ScheduleMutationNotice() {
  const mutation = useScheduleMutationStatus()
  const run = useScheduleRunStatus()
  const deletion = useScheduleDeletionStatus()
  const creation = useScheduleCreationStatus()
  return (
    <>
      <RevisionedMutationNotice
        kind="routine"
        mutation={mutation}
        pendingLabel="Updating routine…"
        onRetry={retryScheduleMutation}
        onDiscard={discardScheduleMutation}
      />
      <RevisionedMutationNotice
        kind="routine-run"
        mutation={run}
        pendingLabel="Starting routine run…"
        onRetry={retryScheduleRun}
        onDiscard={discardScheduleRun}
      />
      <RevisionedMutationNotice
        kind="routine-create"
        mutation={creation}
        pendingLabel="Creating routine…"
        onRetry={retryScheduleCreation}
        onDiscard={discardScheduleCreation}
      />
      <RevisionedMutationNotice
        kind="routine-delete"
        mutation={deletion}
        pendingLabel="Deleting routine…"
        onRetry={retryScheduleDeletion}
        onDiscard={discardScheduleDeletion}
      />
    </>
  )
}
