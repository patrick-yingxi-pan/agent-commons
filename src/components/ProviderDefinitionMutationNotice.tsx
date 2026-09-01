import {
  discardProviderDefinitionMutation,
  retryProviderDefinitionMutation,
  useProviderDefinitionMutationStatus,
} from '../controller/providerDefinitionMutations'
import { RevisionedMutationNotice } from './RevisionedMutationNotice'

/** Shell-level acknowledgement and recovery for provider-definition edits. */
export function ProviderDefinitionMutationNotice() {
  const mutation = useProviderDefinitionMutationStatus()
  return (
    <RevisionedMutationNotice
      kind="provider"
      mutation={mutation}
      pendingLabel="Updating provider…"
      onRetry={retryProviderDefinitionMutation}
      onDiscard={discardProviderDefinitionMutation}
    />
  )
}
