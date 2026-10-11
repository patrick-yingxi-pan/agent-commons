/** Private, modern-only form exchange. This protocol substrate is intentionally
 * unwired: durable, person-bound consent and per-workflow round/expiry limits
 * must exist before a product caller can use it. Never waits for a person with
 * a socket or ephemeral MCP session open, and never constructs the next call. */
import { createMcpFormSession, McpSessionError } from './mcpSession.ts'
import { McpHttpError } from './mcpHttpTransport.ts'
import { snapshotMcpFormToolInvocation, McpToolCallError, type McpFormToolInvocation } from './mcpToolCall.ts'
import { MCP_MODERN_VERSION } from './mcpProtocol.ts'
import type { McpToolSessionOptions } from './mcpToolSession.ts'

export type McpFormToolSessionOptions = Omit<McpToolSessionOptions, 'expectedProtocolVersion'>

/** Each invocation, including a user-approved continuation, is a new bounded
 * one-attempt transaction. The trusted host binds original arguments and prior
 * result to the same person/connection/round; these parsed values are not proof
 * of provenance or authority. A failure must not authorize automatic retry. */
export function createMcpFormToolSession(dependencies: Parameters<typeof createMcpFormSession>[0] = {}) {
  const withSession = createMcpFormSession(dependencies)
  return async (endpoint: string, invocation: McpFormToolInvocation, options: McpFormToolSessionOptions) => {
    const input = { ...options }
    if (input.signal?.aborted) throw new McpToolCallError('cancelled', false)
    const intent = snapshotMcpFormToolInvocation(invocation)
    try {
      const { value: result, ...session } = await withSession(endpoint, input, async (context) => {
        if (context.protocolVersion !== MCP_MODERN_VERSION) throw new McpToolCallError('unsupported_version', false)
        await input.beforeCall?.()
        return context.callToolWithForms(intent, { beforeDispatch: input.beforeCall })
      })
      return { ...session, result }
    } catch (error) {
      if (error instanceof McpToolCallError) throw error
      if (error instanceof McpSessionError || error instanceof McpHttpError) throw new McpToolCallError(error.code, false)
      throw new McpToolCallError('network', false)
    }
  }
}
