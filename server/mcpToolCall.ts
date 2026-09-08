/** One explicit MCP tools/call attempt. Deliberately unconfigured: callers must
 * supply reviewed endpoint/tool authority, validated schemas and arguments,
 * consent, durable effect receipts, and an active legacy session if required.
 * No discovery, negotiation, reinitialization, continuation, or automatic retry
 * can replay this attempt. HTTP cancellation cannot undo a remote effect. */
import { randomUUID } from 'node:crypto'
import { postMcpHttp, McpHttpError, type McpHttpOptions, type McpHttpFailure } from './mcpHttpTransport.ts'
import { rpcResponse } from './mcpHttpResponse.ts'
import { snapshotMcpJson } from './mcpJson.ts'
import { parseMcpHeaderParameters, buildMcpParameterHeaders } from './mcpHeaderParameters.ts'
import { MCP_MODERN_VERSION, isMcpProtocolVersion, mcpRequestMetadata, type McpProtocolVersion } from './mcpProtocol.ts'
import { parseMcpToolResult, McpToolResultError } from './mcpToolResult.ts'

export interface McpToolCall {
  protocolVersion: McpProtocolVersion
  /** Owned by the surrounding initialized legacy session; never renewed here. */
  sessionId?: string
  tool: { name: string; inputSchema: Record<string, unknown> }
  arguments: Record<string, unknown>
}
export class McpToolCallError extends Error {
  readonly code: McpHttpFailure | 'protocol' | 'rpc_error' | 'result' | 'input_required'
  readonly mayHaveExecuted: boolean
  constructor(code: McpToolCallError['code'], mayHaveExecuted: boolean) {
    super(`MCP tool call failed (${code}).`)
    this.name = 'McpToolCallError'
    this.code = code
    this.mayHaveExecuted = mayHaveExecuted
  }
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)

export function createMcpToolCaller({ post = postMcpHttp } = {}) {
  return async (endpoint: string, call: McpToolCall, options: Pick<McpHttpOptions, 'scope' | 'bearerToken' | 'signal' | 'timeoutMs'>) => {
    const input = { ...options }
    if (input.signal?.aborted) throw new McpToolCallError('cancelled', false)
    let request: Record<string, unknown>
    let schema: Record<string, unknown>
    let protocolVersion: McpProtocolVersion
    let sessionId: string | undefined
    try {
      protocolVersion = call.protocolVersion
      sessionId = call.sessionId
      if (!isMcpProtocolVersion(protocolVersion) ||
        (sessionId !== undefined && (protocolVersion === MCP_MODERN_VERSION || typeof sessionId !== 'string' ||
          !/^[\x21-\x7e]{1,256}$/.test(sessionId)))) throw new Error()
      const name = call.tool.name
      if (typeof name !== 'string' || !name || Array.from(name).length > 128 ||
        Array.from(name).some((char) => /^[\u0000-\u001f\u007f-\u009f\ud800-\udfff]$/.test(char))) throw new Error()
      const args = snapshotMcpJson(call.arguments, { maxBytes: 49_152, maxDepth: 32, maxNodes: 4096 })
      const reviewedSchema = snapshotMcpJson(call.tool.inputSchema, { maxBytes: 65_536, maxDepth: 32, maxNodes: 4096 })
      if (!object(args) || !object(reviewedSchema) || reviewedSchema.type !== 'object') throw new Error()
      schema = reviewedSchema
      if (protocolVersion === MCP_MODERN_VERSION) buildMcpParameterHeaders(parseMcpHeaderParameters(schema), args)
      request = { jsonrpc: '2.0', id: randomUUID(), method: 'tools/call', params: { name, arguments: args, ...mcpRequestMetadata(protocolVersion) } }
    } catch { throw new McpToolCallError('request', false) }
    let reply: Awaited<ReturnType<typeof post>>
    try {
      // The transport owns the one DNS/socket/stream deadline and reports the
      // exact pre-/post-submission distinction. Do not race it with a second
      // timer that would mislabel DNS cancellation as an uncertain effect.
      reply = await post(endpoint, request, {
        scope: input.scope, bearerToken: input.bearerToken, signal: input.signal, timeoutMs: input.timeoutMs,
        protocolVersion, ...(sessionId !== undefined ? { sessionId } : {}),
        ...(protocolVersion === MCP_MODERN_VERSION ? { toolInputSchema: schema } : {}),
      })
    } catch (error) {
      if (error instanceof McpHttpError) throw new McpToolCallError(error.code, error.mayHaveExecuted)
      throw new McpToolCallError('network', true)
    }
    // Even a complete but unsupported reply does not establish no effect.
    if (input.signal?.aborted) throw new McpToolCallError('cancelled', true)
    let message: Record<string, unknown>
    try {
      if (reply.sessionId !== undefined && (protocolVersion === MCP_MODERN_VERSION || reply.sessionId !== sessionId)) throw new Error()
      message = rpcResponse(reply.message, request.id as string)
    } catch { throw new McpToolCallError('protocol', true) }
    if (Object.hasOwn(message, 'error')) throw new McpToolCallError('rpc_error', true)
    if (reply.status < 200 || reply.status >= 300) throw new McpToolCallError('protocol', true)
    try { return parseMcpToolResult(message.result, protocolVersion) } catch (error) {
      throw new McpToolCallError(error instanceof McpToolResultError ? error.code : 'result', true)
    }
  }
}

export const callMcpTool = createMcpToolCaller()
