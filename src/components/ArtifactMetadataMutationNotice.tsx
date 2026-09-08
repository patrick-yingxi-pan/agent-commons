import {
  discardArtifactMetadataMutation,
  retryArtifactMetadataMutation,
  useArtifactMetadataMutationStatus,
} from '../controller/artifactMetadataMutations'
import { RevisionedMutationNotice } from './RevisionedMutationNotice'

/** Shell-level acknowledgement/recovery for artifact name edits. */
export function ArtifactMetadataMutationNotice() {
  const mutation = useArtifactMetadataMutationStatus()
  return (
    <RevisionedMutationNotice
      kind="artifact-metadata"
      mutation={mutation}
      pendingLabel="Updating artifact name…"
      onRetry={retryArtifactMetadataMutation}
      onDiscard={discardArtifactMetadataMutation}
    />
  )
}
