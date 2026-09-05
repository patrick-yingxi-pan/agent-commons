import {
  discardAgentProposalVerdict,
  retryAgentProposalVerdict,
  useAgentProposalVerdictStatus,
} from '../controller/agentProposalVerdictMutations.ts'
import { RevisionedMutationNotice } from './RevisionedMutationNotice.tsx'

export function AgentProposalVerdictMutationNotice() {
  const mutation = useAgentProposalVerdictStatus()
  return (
    <RevisionedMutationNotice
      kind="agent-proposal-verdict"
      mutation={mutation}
      pendingLabel="Applying Agent proposal decision…"
      onRetry={retryAgentProposalVerdict}
      onDiscard={discardAgentProposalVerdict}
    />
  )
}
