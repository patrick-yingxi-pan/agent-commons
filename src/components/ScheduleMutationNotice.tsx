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
import { RevisionedMutationNotice } from './RevisionedMutationNotice'

/** One shell owner for routine definition and deletion recovery. */
export function ScheduleMutationNotice() {
  const mutation = useScheduleMutationStatus()
  const deletion = useScheduleDeletionStatus()
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
        kind="routine-delete"
        mutation={deletion}
        pendingLabel="Deleting routine…"
        onRetry={retryScheduleDeletion}
        onDiscard={discardScheduleDeletion}
      />
    </>
  )
}
