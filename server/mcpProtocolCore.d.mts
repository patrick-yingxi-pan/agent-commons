export const MCP_MODERN_VERSION: '2026-07-28'
export const MCP_LEGACY_VERSIONS: readonly ['2025-11-25', '2025-06-18', '2025-03-26']
export const MCP_CLIENT_INFO: Readonly<{ name: 'agent-commons'; version: '0.1.0' }>
export type McpProtocolVersion = typeof MCP_MODERN_VERSION | typeof MCP_LEGACY_VERSIONS[number]
export function isMcpProtocolVersion(value: unknown): value is McpProtocolVersion
export function mcpRequestMetadata(protocolVersion: McpProtocolVersion, options?: { formElicitation?: boolean }): Record<string, unknown>
