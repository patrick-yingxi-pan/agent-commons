import {
  discardDelegationRevocation,
  retryDelegationRevocation,
  useDelegationRevocationStatus,
} from '../controller/delegationRevocationMutations.ts'
import { RevisionedMutationNotice } from './RevisionedMutationNotice.tsx'

export function DelegationRevocationMutationNotice() {
  const mutation = useDelegationRevocationStatus()
  return (
    <RevisionedMutationNotice
      kind="delegation-revoke"
      mutation={mutation}
      pendingLabel="Revoking Delegation…"
      onRetry={retryDelegationRevocation}
      onDiscard={discardDelegationRevocation}
    />
  )
}
