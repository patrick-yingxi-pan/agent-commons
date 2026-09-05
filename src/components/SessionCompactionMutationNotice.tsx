import {
  discardSessionCompaction,
  retrySessionCompaction,
  useSessionCompactionStatus,
} from '../controller/sessionCompactionMutations.ts'
import { RevisionedMutationNotice } from './RevisionedMutationNotice.tsx'

export function SessionCompactionMutationNotice() {
  const mutation = useSessionCompactionStatus()
  return (
    <RevisionedMutationNotice
      kind="session-compaction"
      mutation={mutation}
      pendingLabel="Compacting our conversation so we can keep chatting…"
      onRetry={retrySessionCompaction}
      onDiscard={discardSessionCompaction}
    />
  )
}
