import {
  dismissArtifactPermanentDeletion,
  retryArtifactPermanentDeletion,
  useArtifactPermanentDeletionStatus,
} from '../controller/artifactPermanentDeletionMutations.ts'
import { RevisionedMutationNotice } from './RevisionedMutationNotice.tsx'

export function ArtifactPermanentDeletionMutationNotice() {
  const mutation = useArtifactPermanentDeletionStatus()
  return <div data-artifact-permanent-deletion-status={mutation.error ? 'failed' : mutation.busy ? 'pending' : undefined}>
    <RevisionedMutationNotice
      kind="artifact-delete"
      mutation={mutation}
      pendingLabel="Deleting artifact permanently…"
      onRetry={retryArtifactPermanentDeletion}
      onDiscard={dismissArtifactPermanentDeletion}
    />
  </div>
}
