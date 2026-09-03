import {
  discardDelegationCreation,
  retryDelegationCreation,
  useDelegationCreationStatus,
} from '../controller/delegationCreationMutations.ts'
import { RevisionedMutationNotice } from './RevisionedMutationNotice.tsx'

export function DelegationCreationMutationNotice() {
  const mutation = useDelegationCreationStatus()
  return (
    <RevisionedMutationNotice
      kind="delegation-create"
      mutation={mutation}
      pendingLabel="Establishing Delegation…"
      onRetry={retryDelegationCreation}
      onDiscard={discardDelegationCreation}
    />
  )
}
