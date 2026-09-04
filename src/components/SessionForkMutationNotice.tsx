import {
  discardSessionFork,
  retrySessionFork,
  useSessionForkStatus,
} from '../controller/sessionForkMutations.ts'
import { RevisionedMutationNotice } from './RevisionedMutationNotice.tsx'

export function SessionForkMutationNotice() {
  const mutation = useSessionForkStatus()
  return (
    <RevisionedMutationNotice
      kind="session-fork"
      mutation={mutation}
      pendingLabel="Continuing conversation…"
      onRetry={retrySessionFork}
      onDiscard={discardSessionFork}
    />
  )
}
