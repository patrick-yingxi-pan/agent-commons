import { discardStructuredArtifactMutation, retryStructuredArtifactMutation, useStructuredArtifactMutationStatus } from '../controller/structuredArtifactMutations.ts'
import { RevisionedMutationNotice } from './RevisionedMutationNotice.tsx'

export function StructuredArtifactMutationNotice() {
  const mutation = useStructuredArtifactMutationStatus()
  return <RevisionedMutationNotice kind="structured-artifact" mutation={mutation} pendingLabel="Saving artifact content…" onRetry={retryStructuredArtifactMutation} onDiscard={discardStructuredArtifactMutation} />
}
