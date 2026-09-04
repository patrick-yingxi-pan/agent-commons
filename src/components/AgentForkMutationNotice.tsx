import {
  discardAgentFork,
  retryAgentFork,
  useAgentForkStatus,
} from '../controller/agentForkMutations.ts'
import { RevisionedMutationNotice } from './RevisionedMutationNotice.tsx'

export function AgentForkMutationNotice() {
  const mutation = useAgentForkStatus()
  return (
    <RevisionedMutationNotice
      kind="agent-fork"
      mutation={mutation}
      pendingLabel="Forking Agent…"
      onRetry={retryAgentFork}
      onDiscard={discardAgentFork}
    />
  )
}
