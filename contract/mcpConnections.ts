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

interface McpConnectionViewBase {
  id: string
  label: string
  status: 'unverified' | 'connected' | 'disconnected'
  revision: number
  protocolVersion: string | null
  inspectedAt: number | null
  /** Most recent durable inspection receipt. A later disconnect retains this
   * identity so replay acknowledges current truth without granting access. */
  inspectionOperationId?: string | null
  tools: McpDiscoveredTool[]
  /** Current local schema admission permits proposals, never unattended calls. */
  execution: 'unavailable' | 'approval-required'
  /** Raw names admitted under this version's schema policy. Metadata for other
   * tools remains inspectable but cannot contribute model capabilities. */
  executableTools?: string[]
}

export interface McpHttpConnectionView extends McpConnectionViewBase {
  /** Missing is the fixed legacy HTTP transport; new projections normalize it. */
  transport?: 'http'
  authentication: 'none' | 'device-bearer' | 'device-oauth'
}

export interface McpStdioConnectionView extends McpConnectionViewBase {
  transport: 'stdio'
  authentication?: never
}

export type McpConnectionView = McpHttpConnectionView | McpStdioConnectionView

export interface McpHttpConnectionCreateRequest {
  transport?: 'http'
  creationId: string
  label: string
  endpoint: string
  authentication: 'none' | 'device-bearer' | 'device-oauth'
}

export interface McpStdioConnectionCreateRequest {
  transport: 'stdio'
  creationId: string
  label: string
  endpoint?: never
  authentication?: never
}

export type McpConnectionCreateRequest = McpHttpConnectionCreateRequest | McpStdioConnectionCreateRequest

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

interface McpConnectionInspectionRequestBase {
  operationId: string
  expectedRevision: number
}

export interface McpHttpConnectionInspection extends McpConnectionInspectionRequestBase {
  credentialReference?: string
  grantReference?: never
}

export interface McpStdioConnectionInspection extends McpConnectionInspectionRequestBase {
  grantReference: string
  credentialReference?: never
}

export type McpConnectionInspectionRequest = McpHttpConnectionInspection | McpStdioConnectionInspection

export interface McpConnectionLifecycleRequest {
  expectedRevision: number
}

export interface McpConnectionCapabilities {
  deviceBearerCredentials: boolean
  /** Absent means unavailable. Requires the trusted native OAuth resolver. */
  deviceOAuthCredentials?: boolean
  /** Absent means unavailable. Requires a trusted native local-process owner. */
  localProcesses?: boolean
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
  const transportLabel = connection.transport === 'stdio' ? 'Local MCP process' : 'External MCP'
  return {
    id: connection.id, label: connection.label, kind: 'mcp',
    status: connection.status === 'connected' ? 'connected' : 'needs-auth',
    connectionRevision: connection.revision, lastUsedAt: null, sessions: 0,
    detail: connection.status === 'connected' ? `${transportLabel} · ${connection.tools.length} tools inspected` : `${transportLabel} · connection required`,
  }
}
