import { dismissArtifactHistoryRestore, retryArtifactHistoryRestore, useArtifactHistoryRestoreStatus } from '../controller/artifactHistoryMutations.ts'
import { RevisionedMutationNotice } from './RevisionedMutationNotice'

export function ArtifactHistoryRestoreMutationNotice() {
  const mutation = useArtifactHistoryRestoreStatus()
  if (!mutation.busy && !mutation.error) return null
  return <div
    data-artifact-history-restore-status={mutation.error ? 'failed' : 'pending'}
    data-pending={mutation.busy ? 'true' : 'false'}
  >
    <RevisionedMutationNotice
      kind="artifact-history-restore"
      mutation={mutation}
      pendingLabel="Restoring saved artifact version…"
      onRetry={retryArtifactHistoryRestore}
      onDiscard={dismissArtifactHistoryRestore}
    />
  </div>
}
