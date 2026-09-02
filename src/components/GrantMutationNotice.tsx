import {
  discardGrantMutation,
  retryGrantMutation,
  useGrantMutationStatus,
} from '../controller/grantMutations.ts'
import { RevisionedMutationNotice } from './RevisionedMutationNotice.tsx'

export function GrantMutationNotice() {
  const mutation = useGrantMutationStatus()
  return (
    <RevisionedMutationNotice
      kind="grant"
      mutation={mutation}
      pendingLabel="Updating sharing…"
      onRetry={retryGrantMutation}
      onDiscard={discardGrantMutation}
    />
  )
}
