/** One explicit MCP tools/call attempt. Deliberately unconfigured: callers must
 * supply reviewed endpoint/tool authority, validated schemas and arguments,
 * consent, durable effect receipts, and an active legacy session if required.
 * No discovery, negotiation, reinitialization, or automatic retry can replay
 * this attempt. A separate opt-in form caller accepts one explicitly supplied
 * continuation; neither caller creates one. HTTP cancellation cannot undo a
 * remote effect. */
import { randomUUID } from 'node:crypto'
import { postMcpHttp, McpHttpError, type McpHttpOptions, type McpHttpFailure } from './mcpHttpTransport.ts'
import { rpcResponse } from './mcpHttpResponse.ts'
import { snapshotMcpJson } from './mcpJson.ts'
import { parseMcpHeaderParameters, buildMcpParameterHeaders } from './mcpHeaderParameters.ts'
import { MCP_MODERN_VERSION, isMcpProtocolVersion, mcpRequestMetadata, type McpProtocolVersion } from './mcpProtocol.ts'
import { parseMcpToolResult, McpToolResultError } from './mcpToolResult.ts'
import { parseMcpFormInputRequired, parseMcpFormResponses, McpFormError } from './mcpElicitation.ts'
import type { McpFormInputRequired, McpFormInputResponses } from '../contract/mcpElicitation.ts'
import type { McpToolResult } from '../contract/mcpExecution.ts'

export interface McpToolInvocation {
  tool: { name: string; inputSchema: Record<string, unknown> }
  arguments: Record<string, unknown>
}
export interface McpToolCall extends McpToolInvocation {
  protocolVersion: McpProtocolVersion
  /** Owned by the surrounding initialized legacy session; never renewed here. */
  sessionId?: string
}
/** Private protocol data, not a consent receipt. The host must bind this to the
 * original person, connection, method, arguments and round before dispatch. */
export interface McpFormToolInvocation extends McpToolInvocation {
  continuation?: { pending: McpFormInputRequired; responses: McpFormInputResponses }
}
export interface McpFormToolCall extends McpFormToolInvocation {
  protocolVersion: typeof MCP_MODERN_VERSION
}
export type McpFormToolResult = McpToolResult | McpFormInputRequired
export class McpToolCallError extends Error {
  readonly code: McpHttpFailure | 'protocol' | 'rpc_error' | 'result' | 'input_required' | 'unsupported_version' | 'tools_unavailable' | 'session_expired'
  readonly mayHaveExecuted: boolean
  constructor(code: McpToolCallError['code'], mayHaveExecuted: boolean) {
    super(`MCP tool call failed (${code}).`)
    this.name = 'McpToolCallError'
    this.code = code
    this.mayHaveExecuted = mayHaveExecuted
  }
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)

/** Freeze caller intent before a handshake can yield to other work. Semantic
 * schema validation and permission are still prerequisites, not inferred here. */
export function snapshotMcpToolInvocation(invocation: McpToolInvocation): McpToolInvocation {
  try {
    const name = invocation.tool.name
    if (typeof name !== 'string' || !name || Array.from(name).length > 128 ||
      Array.from(name).some((char) => /^[\u0000-\u001f\u007f-\u009f\ud800-\udfff]$/.test(char))) throw new Error()
    const args = snapshotMcpJson(invocation.arguments, { maxBytes: 49_152, maxDepth: 32, maxNodes: 4096 })
    const schema = snapshotMcpJson(invocation.tool.inputSchema, { maxBytes: 65_536, maxDepth: 32, maxNodes: 4096 })
    if (!object(args) || !object(schema) || schema.type !== 'object') throw new Error()
    return { tool: { name, inputSchema: schema }, arguments: args }
  } catch { throw new McpToolCallError('request', false) }
}

/** Snapshot all continuation data before negotiation, including descriptor and
 * JSON checks. No raw submitted form or opaque state belongs in public history. */
export function snapshotMcpFormToolInvocation(invocation: McpFormToolInvocation): McpFormToolInvocation {
  try {
    const value = snapshotMcpJson(invocation, { maxBytes: 262_144, maxDepth: 36, maxNodes: 24_576 })
    if (!object(value) || Object.keys(value).some(key => !['tool', 'arguments', 'continuation'].includes(key))) throw new Error()
    const base = snapshotMcpToolInvocation(value as unknown as McpToolInvocation)
    if (!Object.hasOwn(value, 'continuation')) return base
    const continuation = value.continuation
    if (!object(continuation) || Object.keys(continuation).length !== 2 ||
        !Object.hasOwn(continuation, 'pending') || !Object.hasOwn(continuation, 'responses')) throw new Error()
    const pending = parseMcpFormInputRequired(continuation.pending)
    const responses = parseMcpFormResponses(pending, continuation.responses)
    return { ...base, continuation: { pending, responses } }
  } catch { throw new McpToolCallError('request', false) }
}

type CallOptions = Pick<McpHttpOptions, 'scope' | 'bearerToken' | 'signal' | 'timeoutMs' | 'beforeDispatch'>
type Dependencies = { post?: typeof postMcpHttp }

function createToolCaller<Call extends McpToolCall, Result>(
  { post = postMcpHttp }: Dependencies,
  prepare: (call: Call) => { invocation: McpToolInvocation; params?: Record<string, unknown> },
  parse: (result: unknown, version: McpProtocolVersion) => Result,
  formElicitation: boolean,
) {
  return async (endpoint: string, call: Call, options: CallOptions): Promise<Result> => {
    const input = { ...options }
    if (input.signal?.aborted) throw new McpToolCallError('cancelled', false)
    let request: Record<string, unknown>
    let schema: Record<string, unknown>
    let protocolVersion: McpProtocolVersion
    let sessionId: string | undefined
    try {
      const { invocation, params } = prepare(call)
      protocolVersion = call.protocolVersion
      sessionId = call.sessionId
      if (!isMcpProtocolVersion(protocolVersion) ||
        (sessionId !== undefined && (protocolVersion === MCP_MODERN_VERSION || typeof sessionId !== 'string' ||
          !/^[\x21-\x7e]{1,256}$/.test(sessionId)))) throw new Error()
      schema = invocation.tool.inputSchema
      if (protocolVersion === MCP_MODERN_VERSION) buildMcpParameterHeaders(parseMcpHeaderParameters(schema), invocation.arguments)
      request = { jsonrpc: '2.0', id: randomUUID(), method: 'tools/call', params: {
        name: invocation.tool.name, arguments: invocation.arguments, ...params,
        ...mcpRequestMetadata(protocolVersion, { formElicitation }),
      } }
    } catch { throw new McpToolCallError('request', false) }
    let reply: Awaited<ReturnType<typeof post>>
    try {
      // The transport owns the one DNS/socket/stream deadline and reports the
      // exact pre-/post-submission distinction. Do not race it with a second
      // timer that would mislabel DNS cancellation as an uncertain effect.
      reply = await post(endpoint, request, {
        scope: input.scope, bearerToken: input.bearerToken, signal: input.signal, timeoutMs: input.timeoutMs,
        beforeDispatch: input.beforeDispatch,
        protocolVersion, ...(sessionId !== undefined ? { sessionId } : {}),
        ...(protocolVersion === MCP_MODERN_VERSION ? { toolInputSchema: schema } : {}),
      })
    } catch (error) {
      if (error instanceof McpHttpError) throw new McpToolCallError(error.code, error.mayHaveExecuted)
      throw new McpToolCallError('network', true)
    }
    // Even a complete but unsupported reply does not establish no effect.
    // A fulfilled transport response won the completion/abort race. Validate
    // that result even if cancellation arrives before this continuation; the
    // transport already refuses a response received after its abort verdict.
    let message: Record<string, unknown>
    try {
      if (reply.sessionId !== undefined && (protocolVersion === MCP_MODERN_VERSION || reply.sessionId !== sessionId)) throw new Error()
      message = rpcResponse(reply.message, request.id as string)
    } catch { throw new McpToolCallError('protocol', true) }
    if (Object.hasOwn(message, 'error')) throw new McpToolCallError('rpc_error', true)
    if (reply.status < 200 || reply.status >= 300) throw new McpToolCallError('protocol', true)
    try { return parse(message.result, protocolVersion) } catch (error) {
      throw new McpToolCallError(error instanceof McpToolResultError ? error.code : error instanceof McpFormError ? 'input_required' : 'result', true)
    }
  }
}

export function createMcpToolCaller(dependencies: Dependencies = {}) {
  return createToolCaller(dependencies, (call: McpToolCall) => {
    // A form continuation on the ordinary path must not silently become a new
    // bare call by discarding its responses/state.
    if (Object.hasOwn(call, 'continuation')) throw new McpToolCallError('request', false)
    return { invocation: snapshotMcpToolInvocation(call) }
  }, parseMcpToolResult, false)
}

/** Deliberately not installed in any product executor. One modern request can
 * return a bounded form or a final result. The host supplies explicit consent,
 * durable round identity, original intent, limits and a fresh deadline; no loop,
 * automatic answer, state interpretation, navigation or replay exists here. */
export function createMcpFormToolCaller(dependencies: Dependencies = {}) {
  return createToolCaller(dependencies, (call: McpFormToolCall) => {
    const value = snapshotMcpJson(call, { maxBytes: 262_144, maxDepth: 36, maxNodes: 24_576 })
    if (!object(value) || value.protocolVersion !== MCP_MODERN_VERSION || Object.hasOwn(value, 'sessionId')) throw new McpToolCallError('request', false)
    // Strip transport authority only; unknown invocation members are refused.
    const { protocolVersion: _version, ...source } = value
    const invocation = snapshotMcpFormToolInvocation(source as unknown as McpFormToolInvocation)
    const continuation = invocation.continuation
    const params = continuation ? {
      inputResponses: continuation.responses,
      ...(continuation.pending.requestState !== undefined ? { requestState: continuation.pending.requestState } : {}),
    } : undefined
    return { invocation, params }
  }, (result, version): McpFormToolResult => {
    const resultType = result && typeof result === 'object' ? Object.getOwnPropertyDescriptor(result, 'resultType')?.value : undefined
    return resultType === 'input_required' ? parseMcpFormInputRequired(result) : parseMcpToolResult(result, version)
  }, true)
}

export const callMcpTool = createMcpToolCaller()
