import {
  cancelApiTokenMintRequest,
  retryApiTokenMint,
  useApiTokenMintStatus,
} from '../controller/apiTokenMintMutations.ts'
import { RevisionedMutationNotice } from './RevisionedMutationNotice.tsx'

export function ApiTokenMintMutationNotice() {
  const mutation = useApiTokenMintStatus()
  return (
    <RevisionedMutationNotice
      kind="api-token-mint"
      mutation={mutation}
      pendingLabel="Securing access-token request…"
      discardLabel="Cancel request"
      onRetry={retryApiTokenMint}
      onDiscard={cancelApiTokenMintRequest}
    />
  )
}
