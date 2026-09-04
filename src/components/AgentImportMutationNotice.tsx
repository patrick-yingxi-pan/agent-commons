import {
  discardAgentImport,
  retryAgentImport,
  useAgentImportStatus,
} from '../controller/agentImportMutations.ts'
import { RevisionedMutationNotice } from './RevisionedMutationNotice.tsx'

export function AgentImportMutationNotice() {
  const mutation = useAgentImportStatus()
  return (
    <RevisionedMutationNotice
      kind="agent-import"
      mutation={mutation}
      pendingLabel="Importing Agent Card…"
      onRetry={retryAgentImport}
      onDiscard={discardAgentImport}
    />
  )
}
