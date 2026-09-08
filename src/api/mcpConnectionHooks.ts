import { useQuery, type QueryState } from './cache.ts'
import { keys } from './keys.ts'
import { getMcpConnection, listMcpConnections } from './mcpConnectionReads.ts'
import type {
  McpConnectionListResponse,
  McpConnectionView,
} from '../../contract/mcpConnections.ts'

export function useMcpConnections(enabled = true): QueryState<McpConnectionListResponse> {
  return useQuery(keys.mcpConnections, listMcpConnections, enabled)
}

export function useMcpConnection(id: string | undefined, enabled = true): QueryState<McpConnectionView> {
  return useQuery(
    keys.mcpConnection(id ?? ''),
    () => getMcpConnection(id!),
    enabled && !!id,
  )
}
