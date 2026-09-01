import {
  discardCommissionMutation,
  retryCommissionMutation,
  useCommissionMutationStatus,
} from '../controller/commissionMutations'
import { RevisionedMutationNotice } from './RevisionedMutationNotice'

/** Shell-level acknowledgement and recovery for contributor configuration. */
export function CommissionMutationNotice() {
  const mutation = useCommissionMutationStatus()
  return (
    <RevisionedMutationNotice
      kind="commission"
      mutation={mutation}
      pendingLabel="Updating contributor…"
      onRetry={retryCommissionMutation}
      onDiscard={discardCommissionMutation}
    />
  )
}
