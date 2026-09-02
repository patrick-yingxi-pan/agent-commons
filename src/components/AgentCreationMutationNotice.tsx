import {
  discardAgentCreation,
  retryAgentCreation,
  useAgentCreationStatus,
} from '../controller/agentCreationMutations.ts'
import { RevisionedMutationNotice } from './RevisionedMutationNotice.tsx'

export function AgentCreationMutationNotice() {
  const mutation = useAgentCreationStatus()
  return (
    <RevisionedMutationNotice
      kind="agent-create"
      mutation={mutation}
      pendingLabel="Creating Agent…"
      onRetry={retryAgentCreation}
      onDiscard={discardAgentCreation}
    />
  )
}
