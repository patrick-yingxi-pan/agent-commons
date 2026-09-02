import {
  discardProviderCreation,
  retryProviderCreation,
  useProviderCreationStatus,
} from '../controller/providerCreationMutations.ts'
import { RevisionedMutationNotice } from './RevisionedMutationNotice.tsx'

export function ProviderCreationMutationNotice() {
  const mutation = useProviderCreationStatus()
  return (
    <RevisionedMutationNotice
      kind="provider-create"
      mutation={mutation}
      pendingLabel="Creating provider…"
      onRetry={retryProviderCreation}
      onDiscard={discardProviderCreation}
    />
  )
}
