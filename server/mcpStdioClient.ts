/** Internal stream protocol client. A trusted native adapter owns launch data,
 * process admission, request IDs, framing, source fences and physical cleanup.
 * No default adapter, URL, shell command, credential or product authority lives
 * here. Schema semantics and durable person-bound consent remain prerequisites. */
import { MCP_MODERN_VERSION, MCP_LEGACY_VERSIONS, MCP_CLIENT_INFO, mcpRequestMetadata, isMcpProtocolVersion, type McpProtocolVersion } from './mcpProtocol.ts'
import { snapshotMcpJson } from './mcpJson.ts'
import { parseMcpToolsPage, MAX_MCP_DISCOVERY_PAGES, MAX_MCP_DISCOVERY_TOOLS, MAX_MCP_CATALOG_BYTES, type McpDiscoveredTool } from './mcpCatalog.ts'
import { snapshotMcpFormToolInvocation, type McpToolInvocation, type McpFormToolInvocation, type McpFormToolResult } from './mcpToolCall.ts'
import { parseMcpToolResult, McpToolResultError, type McpToolResult } from './mcpToolResult.ts'
import { parseMcpFormInputRequired, McpFormError } from './mcpElicitation.ts'
import { isModernMcpErrorCode } from './mcpHttpResponse.ts'

export interface McpStdioConnection {
  /** Must honor cancellation and correlate IDs before fulfilling. A fulfilled
   * response wins over later cancellation; only this request's submission is
   * reported by a rejected { code, mayHaveSubmitted } transport failure. */
  request(method: string, params: Record<string, unknown>, options: {
    signal: AbortSignal; beforeDispatch?: () => boolean
  }): Promise<unknown>
  initialized(): Promise<void>
  /** Starts shutdown; fulfillment confirms physical close, not just a signal. */
  close(): Promise<unknown>
  closed: Promise<unknown>
}
export interface McpStdioClientOptions {
  isCurrent: () => boolean
  signal?: AbortSignal
  timeoutMs?: number
  probeTimeoutMs?: number
}
export interface McpStdioCallOptions extends McpStdioClientOptions {
  expectedProtocolVersion?: McpProtocolVersion
  beforeCall?: () => boolean
}
type FailureCode = 'request' | 'unavailable' | 'busy' | 'cancelled' | 'stale' | 'timeout' | 'closed' | 'protocol' | 'limit' | 'io'
  | 'unsupported_version' | 'tools_unavailable' | 'input_required' | 'catalog' | 'rpc_error' | 'result'
export class McpStdioClientError extends Error {
  readonly code: FailureCode
  readonly mayHaveExecuted: boolean
  constructor(code: FailureCode, mayHaveExecuted = false) {
    super(`Local MCP operation failed (${code}).`)
    this.name = 'McpStdioClientError'
    this.code = code
    // Tool-request uncertainty only. Launching approved local code can itself
    // have effects even if no tool request is sent.
    this.mayHaveExecuted = mayHaveExecuted
  }
}
type Details = { protocolVersion: McpProtocolVersion; serverInfo?: { name: string; version: string; title?: string } }
type Cleanup = 'released' | 'unconfirmed'
type Dependencies = {
  /** A fresh, already-authorized process for this transaction. Never accepts
   * launch configuration from server messages or a model-supplied invocation. */
  open: (options: { signal: AbortSignal; isCurrent: () => boolean }) => McpStdioConnection
  now?: () => number
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const transportCodes = new Set(['unavailable', 'busy', 'cancelled', 'stale', 'timeout', 'closed', 'protocol', 'limit', 'io'])
const responseLimits = { maxBytes: 1_048_576, maxDepth: 40, maxNodes: 32_768 }
const legacy = (value: unknown): value is typeof MCP_LEGACY_VERSIONS[number] => MCP_LEGACY_VERSIONS.some(version => version === value)

function current(check: () => boolean): boolean {
  try {
    const value: unknown = check()
    if (value && typeof (value as PromiseLike<unknown>).then === 'function') void Promise.resolve(value).catch(() => {})
    return value === true
  } catch { return false }
}
function transportFailure(error: unknown, tool: boolean): McpStdioClientError {
  // Injected native errors have fixed own-data fields; raw child diagnostics
  // are never interpolated or retained as a cause.
  const fields = error && typeof error === 'object' ? Object.getOwnPropertyDescriptors(error) : {}
  const code = fields.code?.value
  return new McpStdioClientError(code === 'invalid' ? 'request' : transportCodes.has(code) ? code : 'io',
    tool && fields.mayHaveSubmitted?.value !== false)
}
function response(raw: unknown, tool: boolean): Record<string, unknown> {
  try {
    const value = snapshotMcpJson(raw, responseLimits)
    if (!record(value) || value.jsonrpc !== '2.0' || Object.hasOwn(value, 'method') ||
      !(typeof value.id === 'string' || Number.isSafeInteger(value.id)) ||
      Object.hasOwn(value, 'result') === Object.hasOwn(value, 'error')) throw new Error()
    if (Object.hasOwn(value, 'error') && (!record(value.error) || !Number.isInteger(value.error.code) || typeof value.error.message !== 'string')) throw new Error()
    return value
  } catch { throw new McpStdioClientError('protocol', tool) }
}
function complete(message: Record<string, unknown>, version: McpProtocolVersion): Record<string, unknown> {
  if (Object.hasOwn(message, 'error') || !record(message.result)) throw new McpStdioClientError('protocol')
  if (message.result.resultType === 'input_required') throw new McpStdioClientError('input_required')
  if (version === MCP_MODERN_VERSION ? message.result.resultType !== 'complete'
    : message.result.resultType !== undefined && message.result.resultType !== 'complete') throw new McpStdioClientError('protocol')
  return message.result
}
function describe(announced: Record<string, unknown>, protocolVersion: McpProtocolVersion): Details {
  if (!record(announced.capabilities) || !record(announced.capabilities.tools)) throw new McpStdioClientError('tools_unavailable')
  if (announced._meta !== undefined && !record(announced._meta)) throw new McpStdioClientError('protocol')
  const info = protocolVersion === MCP_MODERN_VERSION
    ? record(announced._meta) ? announced._meta['io.modelcontextprotocol/serverInfo'] : undefined
    : announced.serverInfo
  if (info === undefined && protocolVersion === MCP_MODERN_VERSION) return { protocolVersion }
  const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f-\u009f]/.test(value)
  if (!record(info) || !text(info.name) || !text(info.version) || (info.title !== undefined && !text(info.title))) throw new McpStdioClientError('protocol')
  return { protocolVersion, serverInfo: { name: info.name, version: info.version, ...(info.title === undefined ? {} : { title: info.title }) } }
}

/** Each public operation owns a fresh bounded transaction. A modern probe can
 * continue on its process. A legacy fallback closes/reaps that probe before one
 * fresh initialize; no request after initialization is ever retried. */
export function createMcpStdioClient({ open, now = () => performance.now() }: Dependencies) {
  async function transaction<T>(options: McpStdioClientOptions, forms: boolean,
    run: (details: Details, send: (method: string, params?: Record<string, unknown>, tool?: boolean, guard?: () => boolean) => Promise<Record<string, unknown>>, check: () => void, signal: AbortSignal) => Promise<T>,
    readOnly: boolean,
  ): Promise<Details & { value: T; cleanup: Cleanup }> {
    const input = { ...options }
    const timeoutMs = input.timeoutMs ?? 30_000
    const probeTimeoutMs = input.probeTimeoutMs ?? 2_000
    if (typeof input.isCurrent !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000 ||
      !Number.isSafeInteger(probeTimeoutMs) || probeTimeoutMs < 1 || probeTimeoutMs > 5_000) throw new McpStdioClientError('request')
    const started = now()
    const lifetime = new AbortController()
    const probe = new AbortController()
    let timedOut = false
    let probeExpired = false
    let connection: McpStdioConnection | undefined
    let protocolVersion: McpProtocolVersion = MCP_MODERN_VERSION
    const remaining = () => Math.max(0, Math.floor(timeoutMs - (now() - started)))
    const cancel = () => lifetime.abort()
    input.signal?.addEventListener('abort', cancel, { once: true })
    if (input.signal?.aborted) cancel()
    const timer = setTimeout(() => { timedOut = true; cancel() }, timeoutMs)
    let probeTimer: ReturnType<typeof setTimeout> | undefined
    const check = () => {
      if (lifetime.signal.aborted || !remaining()) throw new McpStdioClientError(timedOut || !remaining() ? 'timeout' : 'cancelled')
      if (!current(input.isCurrent)) throw new McpStdioClientError('stale')
    }
    const release = async (): Promise<Cleanup> => {
      if (!connection) return 'released'
      let waitTimer: ReturnType<typeof setTimeout> | undefined
      try {
        // The native manager keeps physical capacity occupied even if this
        // bounded wait ends. An unconfirmed close never permits era fallback.
        const closing = connection.close()
        const closed = await Promise.race([
          Promise.resolve(closing).then(() => true, () => false),
          new Promise<false>(resolve => { waitTimer = setTimeout(() => resolve(false), Math.min(1_000, remaining())) }),
        ])
        if (closed) connection = undefined
        return closed ? 'released' : 'unconfirmed'
      } catch { return 'unconfirmed' }
      finally { clearTimeout(waitTimer) }
    }
    const send = async (method: string, params: Record<string, unknown> = {}, tool = false, guard?: () => boolean) => {
      check()
      let raw: unknown
      try {
        raw = await connection!.request(method, { ...params, ...mcpRequestMetadata(protocolVersion, { formElicitation: forms }) }, {
          signal: lifetime.signal,
          ...(guard ? { beforeDispatch: guard } : {}),
        })
      } catch (error) {
        const failure = transportFailure(error, tool)
        if (timedOut && failure.code === 'cancelled') throw new McpStdioClientError('timeout', failure.mayHaveExecuted)
        throw failure
      }
      return response(raw, tool)
    }
    let details: Details
    let value: T
    let cleanup: Cleanup = 'unconfirmed'
    try {
      check()
      try { connection = open({ signal: AbortSignal.any([lifetime.signal, probe.signal]), isCurrent: input.isCurrent }) }
      catch (error) { throw transportFailure(error, false) }
      probeTimer = setTimeout(() => { probeExpired = true; probe.abort() }, Math.min(probeTimeoutMs, remaining()))
      let discovered: Record<string, unknown> | undefined
      let fallback = false
      try { discovered = await send('server/discover') }
      catch (error) {
        check()
        if (!(error instanceof McpStdioClientError) ||
          !(error.code === 'closed' || (probeExpired && error.code === 'cancelled'))) throw error
        fallback = true
      } finally { clearTimeout(probeTimer) }
      check()
      if (discovered && Object.hasOwn(discovered, 'error')) {
        const error = discovered.error as Record<string, unknown>
        // A recognized modern error is proof of the modern era, never a reason
        // to reinterpret a call as legacy. This client supports one modern date.
        if (isModernMcpErrorCode(error.code)) throw new McpStdioClientError(error.code === -32022 ? 'unsupported_version' : 'protocol')
        fallback = true
      }
      let announced: Record<string, unknown>
      if (fallback) {
        if (forms) throw new McpStdioClientError('unsupported_version')
        if (await release() !== 'released') throw new McpStdioClientError('closed')
        check()
        protocolVersion = MCP_LEGACY_VERSIONS[0]
        try { connection = open({ signal: lifetime.signal, isCurrent: input.isCurrent }) }
        catch (error) { throw transportFailure(error, false) }
        announced = complete(await send('initialize', { protocolVersion, capabilities: {}, clientInfo: MCP_CLIENT_INFO }), protocolVersion)
        if (!legacy(announced.protocolVersion)) throw new McpStdioClientError('unsupported_version')
        protocolVersion = announced.protocolVersion
        details = describe(announced, protocolVersion)
        check()
        try { await connection.initialized() } catch (error) { throw transportFailure(error, false) }
      } else {
        announced = complete(discovered!, protocolVersion)
        const versions = announced.supportedVersions
        if (!Array.isArray(versions) || !versions.length || versions.length > 16 ||
          versions.some(version => typeof version !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(version))) throw new McpStdioClientError('protocol')
        if (!versions.includes(MCP_MODERN_VERSION)) throw new McpStdioClientError('unsupported_version')
        details = describe(announced, protocolVersion)
      }
      check()
      value = await run(details, send, check, lifetime.signal)
    } finally {
      clearTimeout(probeTimer)
      cleanup = await release()
      clearTimeout(timer)
      input.signal?.removeEventListener('abort', cancel)
      lifetime.abort()
    }
    // Cleanup cannot erase a known tool response. A read-only catalog, however,
    // must still be current when it is published to its trusted caller.
    if (readOnly) {
      if (input.signal?.aborted || timedOut || !remaining()) throw new McpStdioClientError(timedOut || !remaining() ? 'timeout' : 'cancelled')
      if (!current(input.isCurrent)) throw new McpStdioClientError('stale')
    }
    return { ...details!, value: value!, cleanup }
  }

  async function discover(options: McpStdioClientOptions) {
    const { value: tools, ...details } = await transaction(options, false, async (details, send) => {
      const tools: McpDiscoveredTool[] = []
      const names = new Set<string>(), cursors = new Set<string>()
      let cursor: string | undefined, bytes = 0
      for (let page = 0; page < MAX_MCP_DISCOVERY_PAGES; page++) {
        const raw = complete(await send('tools/list', cursor ? { cursor } : {}), details.protocolVersion)
        bytes += new TextEncoder().encode(JSON.stringify(raw)).byteLength
        if (bytes > MAX_MCP_CATALOG_BYTES) throw new McpStdioClientError('catalog')
        let parsed: ReturnType<typeof parseMcpToolsPage>
        try { parsed = parseMcpToolsPage(raw) } catch { throw new McpStdioClientError('catalog') }
        for (const tool of parsed.tools) {
          if (names.has(tool.name) || tools.length >= MAX_MCP_DISCOVERY_TOOLS) throw new McpStdioClientError('catalog')
          names.add(tool.name)
          tools.push(tool)
        }
        cursor = parsed.nextCursor
        if (!cursor) return tools
        if (cursors.has(cursor)) throw new McpStdioClientError('catalog')
        cursors.add(cursor)
      }
      throw new McpStdioClientError('catalog')
    }, true)
    return { ...details, tools }
  }

  async function invoke<R>(invocation: McpFormToolInvocation, options: McpStdioCallOptions, forms: boolean,
    parse: (result: unknown, protocol: McpProtocolVersion) => R,
  ) {
    const input = { ...options }
    let intent: McpFormToolInvocation
    try {
      intent = snapshotMcpFormToolInvocation(invocation)
      if ((!forms && Object.hasOwn(intent, 'continuation')) ||
        (input.expectedProtocolVersion !== undefined && !isMcpProtocolVersion(input.expectedProtocolVersion)) ||
        (input.beforeCall !== undefined && typeof input.beforeCall !== 'function')) throw new Error()
    } catch { throw new McpStdioClientError('request') }
    const { value: result, ...details } = await transaction(input, forms, async (details, send, check, signal) => {
      if (input.expectedProtocolVersion !== undefined && input.expectedProtocolVersion !== details.protocolVersion) throw new McpStdioClientError('unsupported_version')
      if (input.beforeCall) {
        // Observe even a non-conforming asynchronous preflight, but never let
        // it outlive the transaction or authorize the synchronous write edge.
        let abort: (() => void) | undefined
        try {
          const answer = await Promise.race([Promise.resolve().then(input.beforeCall), new Promise<never>((_resolve, reject) => {
            abort = () => { try { check() } catch (error) { reject(error) } }
            signal.addEventListener('abort', abort, { once: true })
            if (signal.aborted) abort()
          })])
          if (answer !== true) throw new McpStdioClientError('stale')
        } catch (error) { throw error instanceof McpStdioClientError ? error : new McpStdioClientError('stale') }
        finally { if (abort) signal.removeEventListener('abort', abort) }
      }
      check()
      const continuation = intent.continuation
      const message = await send('tools/call', { name: intent.tool.name, arguments: intent.arguments,
        ...(continuation ? { inputResponses: continuation.responses,
          ...(continuation.pending.requestState === undefined ? {} : { requestState: continuation.pending.requestState }) } : {}),
      }, true, () => {
        try { check() } catch { return false }
        return input.beforeCall === undefined || current(input.beforeCall)
      })
      if (Object.hasOwn(message, 'error')) throw new McpStdioClientError('rpc_error', true)
      try { return parse(message.result, details.protocolVersion) }
      catch (error) { throw new McpStdioClientError(error instanceof McpToolResultError ? error.code : error instanceof McpFormError ? 'input_required' : 'result', true) }
    }, false)
    return { ...details, result }
  }
  return Object.freeze({
    discover,
    callTool: (invocation: McpToolInvocation, options: McpStdioCallOptions) => invoke<McpToolResult>(invocation, options, false, parseMcpToolResult),
    callToolWithForms: (invocation: McpFormToolInvocation, options: McpStdioCallOptions) => invoke<McpFormToolResult>(invocation, options, true,
      (result, version) => record(result) && result.resultType === 'input_required' ? parseMcpFormInputRequired(result) : parseMcpToolResult(result, version)),
  })
}
