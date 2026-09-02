import {
  discardSavedContextConnectionMutation,
  retrySavedContextConnectionMutation,
  useSavedContextConnectionMutationStatus,
} from '../controller/savedContextConnectionMutations'
import { RevisionedMutationNotice } from './RevisionedMutationNotice'

/** Shell-level acknowledgement and recovery for Context connection changes. */
export function SavedContextMutationNotice() {
  const mutation = useSavedContextConnectionMutationStatus()
  return (
    <RevisionedMutationNotice
      kind="saved-context"
      mutation={mutation}
      pendingLabel="Updating context…"
      onRetry={retrySavedContextConnectionMutation}
      onDiscard={discardSavedContextConnectionMutation}
    />
  )
}
