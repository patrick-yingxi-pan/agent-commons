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
  tools: McpDiscoveredTool[]
  /** Inspection does not yet enable the unfinished tool-execution adapter. */
  execution: 'unavailable'
}

/** A distinct namespace prevents fixture setup from minting real authority. */
export const EXTERNAL_MCP_ID_PREFIX = 'mcp-connection-'
export function isExternalMcpId(id: string): boolean {
  return id.startsWith(EXTERNAL_MCP_ID_PREFIX)
}
