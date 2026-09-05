import {
  discardApiTokenRevocation,
  retryApiTokenRevocation,
  useApiTokenRevocationStatus,
} from '../controller/apiTokenRevocationMutations.ts'
import { RevisionedMutationNotice } from './RevisionedMutationNotice.tsx'

export function ApiTokenRevocationMutationNotice() {
  const mutation = useApiTokenRevocationStatus()
  return (
    <RevisionedMutationNotice
      kind="api-token-revoke"
      mutation={mutation}
      pendingLabel="Revoking access token…"
      onRetry={retryApiTokenRevocation}
      onDiscard={discardApiTokenRevocation}
    />
  )
}
