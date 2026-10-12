import { dismissCommissionMcpMutation, retryCommissionMcpMutation, useCommissionMcpMutationStatus } from '../controller/commissionMcpMutations.ts'
import { RevisionedMutationNotice } from './RevisionedMutationNotice.tsx'

export function CommissionMcpMutationNotice() {
  return <RevisionedMutationNotice kind="commission-mcp" mutation={useCommissionMcpMutationStatus()} pendingLabel="Confirming unattended Contributor approval…" onRetry={retryCommissionMcpMutation} onDiscard={dismissCommissionMcpMutation} />
}
