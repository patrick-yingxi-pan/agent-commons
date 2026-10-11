/** Native-only transient launch input. Never part of a portable MCP connection,
 * HTTP request, model context, browser storage, or diagnostic projection. */
export interface McpStdioLaunch {
  executable: string
  args: readonly string[]
  cwd: string
  env: Readonly<Record<string, string>>
}
export interface McpStdioSetupSource { tenantId: string; userId: string }
export interface McpStdioSetupStartRequest {
  connectionId: string
  expectedRevision: number
  source: McpStdioSetupSource
  launch: McpStdioLaunch
}
export type McpStdioSetupStatus = 'ready' | 'working' | 'connected' | 'disconnected' | 'failed' | 'cancelled' | 'uncertain'
export interface McpStdioSetupView {
  flowId: string
  connectionId: string
  revision: number
  status: McpStdioSetupStatus
}
export type McpStdioSetupErrorCode = 'invalid' | 'unavailable' | 'stale' | 'busy' | 'cancelled' | 'expired'
export interface NativeMcpStdioBridge {
  start(request: McpStdioSetupStartRequest): Promise<McpStdioSetupView>
  authorize(request: { flowId: string }): Promise<McpStdioSetupView>
  reconcile(request: { flowId: string }): Promise<McpStdioSetupView>
  cancel(request: { flowId: string }): Promise<McpStdioSetupView>
}
