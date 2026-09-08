/** Supported protocol eras and first-party request metadata have one owner. */
export const MCP_MODERN_VERSION = '2026-07-28'
export const MCP_LEGACY_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'] as const
export type McpProtocolVersion = typeof MCP_MODERN_VERSION | typeof MCP_LEGACY_VERSIONS[number]
export const MCP_CLIENT_INFO = Object.freeze({ name: 'agent-commons', version: '0.1.0' })
export const isMcpProtocolVersion = (value: unknown): value is McpProtocolVersion =>
  value === MCP_MODERN_VERSION || MCP_LEGACY_VERSIONS.some((version) => version === value)

export function mcpRequestMetadata(protocolVersion: McpProtocolVersion): Record<string, unknown> {
  return protocolVersion === MCP_MODERN_VERSION ? { _meta: {
    'io.modelcontextprotocol/protocolVersion': protocolVersion,
    'io.modelcontextprotocol/clientInfo': { ...MCP_CLIENT_INFO },
    'io.modelcontextprotocol/clientCapabilities': {},
  } } : {}
}
