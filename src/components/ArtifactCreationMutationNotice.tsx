import { discardArtifactCreation, retryArtifactCreation, useArtifactCreationStatus } from '../controller/artifactCreationMutations.ts'
import { RevisionedMutationNotice } from './RevisionedMutationNotice.tsx'

export function ArtifactCreationMutationNotice() {
  return <RevisionedMutationNotice kind="artifact-create" mutation={useArtifactCreationStatus()} pendingLabel="Creating artifact…" onRetry={retryArtifactCreation} onDiscard={discardArtifactCreation} />
}
