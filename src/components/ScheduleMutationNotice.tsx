import {
  discardScheduleMutation,
  retryScheduleMutation,
  useScheduleMutationStatus,
} from '../controller/scheduleMutations'
import { RevisionedMutationNotice } from './RevisionedMutationNotice'

/** Shell-level acknowledgement/recovery for routine definition edits. */
export function ScheduleMutationNotice() {
  const mutation = useScheduleMutationStatus()
  return (
    <RevisionedMutationNotice
      kind="routine"
      mutation={mutation}
      pendingLabel="Updating routine…"
      onRetry={retryScheduleMutation}
      onDiscard={discardScheduleMutation}
    />
  )
}
