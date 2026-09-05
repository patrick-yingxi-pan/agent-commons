import {
  discardAgentProposalCommentCreation,
  retryAgentProposalCommentCreation,
  useAgentProposalCommentCreationStatus,
} from '../controller/agentProposalCommentCreationMutations.ts'
import { RevisionedMutationNotice } from './RevisionedMutationNotice.tsx'

export function AgentProposalCommentCreationMutationNotice() {
  const mutation = useAgentProposalCommentCreationStatus()
  return (
    <RevisionedMutationNotice
      kind="agent-proposal-comment-create"
      mutation={mutation}
      pendingLabel="Posting Agent proposal comment…"
      onRetry={retryAgentProposalCommentCreation}
      onDiscard={discardAgentProposalCommentCreation}
    />
  )
}
