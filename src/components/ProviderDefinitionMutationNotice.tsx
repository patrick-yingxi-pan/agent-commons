import {
  discardProviderDefinitionMutation,
  retryProviderDefinitionMutation,
  useProviderDefinitionMutationStatus,
} from '../controller/providerDefinitionMutations'
import {
  discardProviderDeletion,
  retryProviderDeletion,
  useProviderDeletionStatus,
} from '../controller/providerDeletionMutations.ts'
import { RevisionedMutationNotice } from './RevisionedMutationNotice'

/** Shell-level acknowledgement and recovery for Provider definition/removal. */
export function ProviderDefinitionMutationNotice() {
  const mutation = useProviderDefinitionMutationStatus()
  const deletion = useProviderDeletionStatus()
  return (
    <>
      <RevisionedMutationNotice
        kind="provider"
        mutation={mutation}
        pendingLabel="Updating provider…"
        onRetry={retryProviderDefinitionMutation}
        onDiscard={discardProviderDefinitionMutation}
      />
      <RevisionedMutationNotice
        kind="provider-delete"
        mutation={deletion}
        pendingLabel="Removing Provider…"
        onRetry={retryProviderDeletion}
        onDiscard={discardProviderDeletion}
      />
    </>
  )
}
