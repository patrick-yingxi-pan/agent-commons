import {
  discardProviderConnection,
  retryProviderConnection,
  useProviderConnectionStatus,
} from '../controller/providerConnectionMutations.ts'
import { RevisionedMutationNotice } from './RevisionedMutationNotice.tsx'

export function ProviderConnectionMutationNotice() {
  const mutation = useProviderConnectionStatus()
  return (
    <RevisionedMutationNotice
      kind="provider-connection"
      mutation={mutation}
      pendingLabel="Verifying provider connection…"
      onRetry={retryProviderConnection}
      onDiscard={discardProviderConnection}
    />
  )
}
