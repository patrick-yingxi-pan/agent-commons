import {
  discardArtifactContentMutation,
  retryArtifactContentMutation,
  useArtifactContentMutationStatus,
} from '../controller/artifactContentMutations'
import { RevisionedMutationNotice } from './RevisionedMutationNotice'

/** Shell-level acknowledgement/recovery for artifact body edits. */
export function ArtifactContentMutationNotice() {
  const mutation = useArtifactContentMutationStatus()
  return (
    <RevisionedMutationNotice
      kind="artifact"
      mutation={mutation}
      pendingLabel="Updating document…"
      onRetry={retryArtifactContentMutation}
      onDiscard={discardArtifactContentMutation}
    />
  )
}
