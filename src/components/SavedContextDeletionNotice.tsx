import {
  discardSavedContextDeletion,
  retrySavedContextDeletion,
  useSavedContextDeletionStatus,
} from '../controller/savedContextDeletionMutations'
import { RevisionedMutationNotice } from './RevisionedMutationNotice'

/** Shell-level acknowledgement and recovery for saved Context removal. */
export function SavedContextDeletionNotice() {
  const mutation = useSavedContextDeletionStatus()
  return (
    <RevisionedMutationNotice
      kind="saved-context-delete"
      mutation={mutation}
      pendingLabel="Removing context…"
      onRetry={retrySavedContextDeletion}
      onDiscard={discardSavedContextDeletion}
    />
  )
}
