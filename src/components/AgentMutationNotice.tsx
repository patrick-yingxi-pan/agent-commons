import {
  discardAgentMutation,
  retryAgentMutation,
  useAgentMutationStatus,
} from '../controller/agentMutations'
import {
  discardAgentDeletion,
  retryAgentDeletion,
  useAgentDeletionStatus,
} from '../controller/agentDeletionMutations.ts'
import { RevisionedMutationNotice } from './RevisionedMutationNotice'

/** Shell-level acknowledgement and recovery for Agent configuration/removal. */
export function AgentMutationNotice() {
  const mutation = useAgentMutationStatus()
  const deletion = useAgentDeletionStatus()
  return (
    <>
      <RevisionedMutationNotice
        kind="agent"
        mutation={mutation}
        pendingLabel="Updating agent…"
        onRetry={retryAgentMutation}
        onDiscard={discardAgentMutation}
      />
      <RevisionedMutationNotice
        kind="agent-delete"
        mutation={deletion}
        pendingLabel="Removing Agent…"
        onRetry={retryAgentDeletion}
        onDiscard={discardAgentDeletion}
      />
    </>
  )
}
