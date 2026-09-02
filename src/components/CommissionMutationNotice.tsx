import {
  discardCommissionMutation,
  retryCommissionMutation,
  useCommissionMutationStatus,
} from '../controller/commissionMutations'
import {
  discardCommissionDeletion,
  retryCommissionDeletion,
  useCommissionDeletionStatus,
} from '../controller/commissionDeletionMutations.ts'
import { RevisionedMutationNotice } from './RevisionedMutationNotice'

/** Shell-level acknowledgement and recovery for Contributor configuration/removal. */
export function CommissionMutationNotice() {
  const mutation = useCommissionMutationStatus()
  const deletion = useCommissionDeletionStatus()
  return (
    <>
      <RevisionedMutationNotice
        kind="commission"
        mutation={mutation}
        pendingLabel="Updating contributor…"
        onRetry={retryCommissionMutation}
        onDiscard={discardCommissionMutation}
      />
      <RevisionedMutationNotice
        kind="commission-delete"
        mutation={deletion}
        pendingLabel="Removing Contributor…"
        onRetry={retryCommissionDeletion}
        onDiscard={discardCommissionDeletion}
      />
    </>
  )
}
