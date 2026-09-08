import type { SavedContext } from './contexts.ts'

/** External MCP metadata is untrusted presentation data, never execution consent. */
export interface McpDiscoveredTool {
  name: string
  title?: string
  description?: string
  inputSchema: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  annotations?: Record<string, unknown>
}

export interface McpConnectionView {
  id: string
  label: string
  status: 'unverified' | 'connected' | 'disconnected'
  revision: number
  authentication: 'none' | 'device-bearer'
  protocolVersion: string | null
  inspectedAt: number | null
  /** Most recent durable inspection receipt. A later disconnect retains this
   * identity so replay acknowledges current truth without granting access. */
  inspectionOperationId?: string | null
  tools: McpDiscoveredTool[]
  /** Inspection does not yet enable the unfinished tool-execution adapter. */
  execution: 'unavailable'
}

export interface McpConnectionCreateRequest {
  creationId: string
  label: string
  endpoint: string
  authentication: 'none' | 'device-bearer'
}

export interface McpConnectionCreateResult {
  connection: McpConnectionView
  created: boolean
}

/** Authentication ceremony only; excluded from ordinary connection reads. */
export interface McpCredentialBinding {
  tenantId: string
  connectionId: string
  endpoint: string
}
export interface McpCredentialBindingResponse { binding: McpCredentialBinding }

export interface McpConnectionInspectionRequest {
  operationId: string
  expectedRevision: number
  credentialReference?: string
}

export interface McpConnectionLifecycleRequest {
  expectedRevision: number
}

export interface McpConnectionCapabilities {
  deviceBearerCredentials: boolean
  loopbackConnections: boolean
  credentialCleanupPending: boolean
}

export interface McpConnectionListResponse {
  connections: McpConnectionView[]
  capabilities: McpConnectionCapabilities
}

export type McpCredentialCleanup = 'complete' | 'pending'

export interface McpConnectionMutationResult {
  connection: McpConnectionView
  credentialCleanup: McpCredentialCleanup
}

export interface McpConnectionRemovalResult {
  removed: boolean
  credentialCleanup: McpCredentialCleanup
}

/** A distinct namespace prevents fixture setup from minting real authority. */
export const EXTERNAL_MCP_ID_PREFIX = 'mcp-connection-'
export function isExternalMcpId(id: string): boolean {
  return id.startsWith(EXTERNAL_MCP_ID_PREFIX)
}

/** One context synopsis for server truth and a held reviewed UI snapshot. */
export function mcpConnectionContext(connection: McpConnectionView): SavedContext {
  return {
    id: connection.id, label: connection.label, kind: 'mcp',
    status: connection.status === 'connected' ? 'connected' : 'needs-auth',
    connectionRevision: connection.revision, lastUsedAt: null, sessions: 0,
    detail: connection.status === 'connected' ? `External MCP · ${connection.tools.length} tools inspected` : 'External MCP · connection required',
  }
}
