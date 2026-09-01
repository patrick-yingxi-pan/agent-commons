import {
  discardSessionDeletion,
  retrySessionDeletion,
  useSessionDeletionStatus,
} from '../controller/sessionDeletionMutations'
import { RevisionedMutationNotice } from './RevisionedMutationNotice'

/** One shell-level acknowledgement/recovery surface for conversation deletion. */
export function SessionDeletionNotice() {
  const mutation = useSessionDeletionStatus()
  return (
    <RevisionedMutationNotice
      kind="conversation-delete"
      mutation={mutation}
      pendingLabel="Deleting conversation…"
      onRetry={retrySessionDeletion}
      onDiscard={discardSessionDeletion}
    />
  )
}
