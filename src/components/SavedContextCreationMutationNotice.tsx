import {
  discardSavedContextCreation,
  retrySavedContextCreation,
  useSavedContextCreationStatus,
} from '../controller/savedContextCreationMutations.ts'
import { RevisionedMutationNotice } from './RevisionedMutationNotice.tsx'

/** Shell-level acknowledgement and recovery for adding reusable Context setup. */
export function SavedContextCreationMutationNotice() {
  const mutation = useSavedContextCreationStatus()
  return (
    <RevisionedMutationNotice
      kind="saved-context-create"
      mutation={mutation}
      pendingLabel="Adding context…"
      onRetry={retrySavedContextCreation}
      onDiscard={discardSavedContextCreation}
    />
  )
}
