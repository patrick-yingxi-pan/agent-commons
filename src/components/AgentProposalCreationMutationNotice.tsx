import {
  discardAgentProposalCreation,
  retryAgentProposalCreation,
  useAgentProposalCreationStatus,
} from '../controller/agentProposalCreationMutations.ts'
import { RevisionedMutationNotice } from './RevisionedMutationNotice.tsx'

export function AgentProposalCreationMutationNotice() {
  const mutation = useAgentProposalCreationStatus()
  return (
    <RevisionedMutationNotice
      kind="agent-proposal-create"
      mutation={mutation}
      pendingLabel="Opening Agent proposal…"
      onRetry={retryAgentProposalCreation}
      onDiscard={discardAgentProposalCreation}
    />
  )
}
