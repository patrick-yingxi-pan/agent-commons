import {
  discardAgentMutation,
  retryAgentMutation,
  useAgentMutationStatus,
} from '../controller/agentMutations'
import { RevisionedMutationNotice } from './RevisionedMutationNotice'

/** Shell-level acknowledgement and recovery for Agent configuration edits. */
export function AgentMutationNotice() {
  const mutation = useAgentMutationStatus()
  return (
    <RevisionedMutationNotice
      kind="agent"
      mutation={mutation}
      pendingLabel="Updating agent…"
      onRetry={retryAgentMutation}
      onDiscard={discardAgentMutation}
    />
  )
}
