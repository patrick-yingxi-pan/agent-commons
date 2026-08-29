import {
  discardProposalVerdict,
  retryProposalVerdict,
  useProposalVerdictMutationStatus,
} from '../controller/proposalVerdictMutations'
import { RevisionedMutationNotice } from './RevisionedMutationNotice'

/** One shell-level acknowledgement/recovery surface for proposal decisions. */
export function ProposalVerdictMutationNotice() {
  const mutation = useProposalVerdictMutationStatus()
  return (
    <RevisionedMutationNotice
      kind="proposal"
      mutation={mutation}
      pendingLabel="Recording proposal verdict…"
      onRetry={retryProposalVerdict}
      onDiscard={discardProposalVerdict}
    />
  )
}
