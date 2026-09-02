import {
  discardCommissionCreation,
  retryCommissionCreation,
  useCommissionCreationStatus,
} from '../controller/commissionCreationMutations.ts'
import { RevisionedMutationNotice } from './RevisionedMutationNotice.tsx'

export function CommissionCreationMutationNotice() {
  const mutation = useCommissionCreationStatus()
  return (
    <RevisionedMutationNotice
      kind="commission-create"
      mutation={mutation}
      pendingLabel="Commissioning Agent…"
      onRetry={retryCommissionCreation}
      onDiscard={discardCommissionCreation}
    />
  )
}
