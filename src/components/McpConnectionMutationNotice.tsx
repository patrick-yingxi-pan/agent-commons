import {
  discardMcpConnectionMutation, retryMcpConnectionMutation, useMcpConnectionMutationStatus,
} from '../controller/mcpConnectionMutations.ts'
import { RevisionedMutationNotice } from './RevisionedMutationNotice.tsx'

/** Shared shell recovery survives leaving the connection page or setup form. */
export function McpConnectionMutationNotice() {
  const mutation = useMcpConnectionMutationStatus()
  return <RevisionedMutationNotice kind="mcp-connection" mutation={mutation}
    pendingLabel="Updating MCP connection…" onRetry={retryMcpConnectionMutation} onDiscard={discardMcpConnectionMutation} />
}
