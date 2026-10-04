import { discardArtifactLifecycle, retryArtifactLifecycle, useArtifactLifecycleStatus } from '../controller/artifactLifecycleMutations'
import { RevisionedMutationNotice } from './RevisionedMutationNotice'

export function ArtifactLifecycleMutationNotice() {
  const mutation = useArtifactLifecycleStatus()
  return <RevisionedMutationNotice kind="artifact-lifecycle" mutation={mutation} pendingLabel="Confirming artifact action…" onRetry={retryArtifactLifecycle} onDiscard={discardArtifactLifecycle} />
}
