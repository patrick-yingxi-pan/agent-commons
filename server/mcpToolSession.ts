/** Negotiated single-call transaction, intentionally not installed in the
 * connector runtime. This is not authorization, schema validation or a durable
 * receipt. Legacy sessions belong to this invocation and are never reused. */
import { createMcpSession, McpSessionError, type McpSessionOptions } from './mcpSession.ts'
import { McpHttpError } from './mcpHttpTransport.ts'
import { snapshotMcpToolInvocation, McpToolCallError, type McpToolInvocation } from './mcpToolCall.ts'
import type { McpProtocolVersion } from './mcpProtocol.ts'

export interface McpToolSessionOptions extends McpSessionOptions {
  /** Pins execution to the protocol under which the reviewed catalog was
   * admitted. A changed negotiation cannot silently reinterpret its schema. */
  expectedProtocolVersion?: McpProtocolVersion
  /** Last authority check after negotiation and immediately before tools/call.
   * Throwing from this hook is a known pre-submission refusal. */
  beforeCall?: () => void
}

export function createMcpToolSession(dependencies: Parameters<typeof createMcpSession>[0] = {}) {
  const withSession = createMcpSession(dependencies)
  return async (endpoint: string, invocation: McpToolInvocation, options: McpToolSessionOptions) => {
    const input = { ...options }
    if (input.signal?.aborted) throw new McpToolCallError('cancelled', false)
    if (invocation && Object.hasOwn(invocation, 'continuation')) throw new McpToolCallError('request', false)
    const intent = snapshotMcpToolInvocation(invocation)
    try {
      const { value: result, ...session } = await withSession(endpoint, input, async (context) => {
        if (input.expectedProtocolVersion !== undefined && context.protocolVersion !== input.expectedProtocolVersion) {
          throw new McpToolCallError('unsupported_version', false)
        }
        // Observe a runtime caller's non-conforming rejected promise here;
        // the actual synchronous dispatch edge still refuses all thenables.
        await input.beforeCall?.()
        return context.callTool(intent, { beforeDispatch: input.beforeCall })
      })
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
