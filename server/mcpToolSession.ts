/** Negotiated single-call transaction, intentionally not installed in the
 * connector runtime. This is not authorization, schema validation or a durable
 * receipt. Legacy sessions belong to this invocation and are never reused. */
import { createMcpSession, McpSessionError, type McpSessionOptions } from './mcpSession.ts'
import { McpHttpError } from './mcpHttpTransport.ts'
import { snapshotMcpToolInvocation, McpToolCallError, type McpToolInvocation } from './mcpToolCall.ts'

export function createMcpToolSession(dependencies: Parameters<typeof createMcpSession>[0] = {}) {
  const withSession = createMcpSession(dependencies)
  return async (endpoint: string, invocation: McpToolInvocation, options: McpSessionOptions) => {
    const input = { ...options }
    if (input.signal?.aborted) throw new McpToolCallError('cancelled', false)
    const intent = snapshotMcpToolInvocation(invocation)
    try {
      const { value: result, ...session } = await withSession(endpoint, input, (context) => context.callTool(intent))
      return { ...session, result }
    } catch (error) {
      // Only the tool attempt can report possible execution. Handshake I/O,
      // including a refused initialization notification, is not that attempt.
      if (error instanceof McpToolCallError) throw error
      if (error instanceof McpSessionError || error instanceof McpHttpError) throw new McpToolCallError(error.code, false)
      throw new McpToolCallError('network', false)
    }
  }
}

export const callMcpToolWithSession = createMcpToolSession()
