import {
  discardOpenWorkCreation,
  retryOpenWorkCreation,
  useOpenWorkCreationStatus,
} from '../controller/openWorkCreationMutations.ts'
import { RevisionedMutationNotice } from './RevisionedMutationNotice.tsx'

export function OpenWorkCreationMutationNotice() {
  const mutation = useOpenWorkCreationStatus()
  return (
    <RevisionedMutationNotice
      kind="open-work-create"
      mutation={mutation}
      pendingLabel="Posting work item…"
      onRetry={retryOpenWorkCreation}
      onDiscard={discardOpenWorkCreation}
    />
  )
}
