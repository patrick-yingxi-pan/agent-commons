/** Ephemeral MCP protocol lifecycle. The session credential never leaves this
 * scope; discovery and a single tool attempt share negotiation and cleanup,
 * not permission. Read-only discovery may explicitly renew one expired legacy
 * session; tool calls and generic callbacks are never replayed. Transport-owned
 * legacy GET resumption and cancellation
 * control traffic preserve the original request identity and deadline;
 * a future configured adapter still owns policy and durable state. */
import { randomUUID } from 'node:crypto'
import { postMcpHttp, McpHttpError, type McpHttpOptions } from './mcpHttpTransport.ts'
import { isModernMcpErrorCode } from './mcpHttpResponse.ts'
import { MCP_MODERN_VERSION, MCP_LEGACY_VERSIONS, MCP_CLIENT_INFO, mcpRequestMetadata, type McpProtocolVersion } from './mcpProtocol.ts'
import { createMcpToolCaller, McpToolCallError, type McpToolInvocation } from './mcpToolCall.ts'
import type { McpToolResult } from './mcpToolResult.ts'

export type McpSessionOptions = Pick<McpHttpOptions, 'scope' | 'bearerToken' | 'signal' | 'timeoutMs'>
export type McpSessionCleanup = 'not-needed' | 'released' | 'server-managed' | 'unconfirmed'
export interface McpSessionDetails {
  protocolVersion: McpProtocolVersion
  serverInfo?: { name: string; version: string; title?: string }
}
interface McpSession extends McpSessionDetails {
  listTools(params?: { cursor?: string }): Promise<Record<string, unknown>>
  restartExpiredSession(): Promise<void>
  callTool(invocation: McpToolInvocation): Promise<McpToolResult>
}
export class McpSessionError extends Error {
  readonly code: 'protocol' | 'unsupported_version' | 'tools_unavailable' | 'input_required' | 'session_expired'
  constructor(code: McpSessionError['code']) { super(`MCP session failed (${code}).`); this.code = code }
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const MAX_CANCELLATION_MS = 1_000
const legacy = (version: unknown): version is typeof MCP_LEGACY_VERSIONS[number] => MCP_LEGACY_VERSIONS.some((supported) => supported === version)
const versions = (value: unknown): string[] => {
  if (!Array.isArray(value) || !value.length || value.length > 16 ||
    value.some((item) => typeof item !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(item))) throw new McpSessionError('protocol')
  return value as string[]
}
const serverInfo = (value: unknown): McpSessionDetails['serverInfo'] => {
  if (value === undefined) return undefined
  const text = (entry: unknown) => typeof entry === 'string' && entry.length > 0 && entry.length <= 256 && !/[\u0000-\u001f\u007f]/.test(entry)
  if (!object(value) || !text(value.name) || !text(value.version) ||
    (value.title !== undefined && !text(value.title))) throw new McpSessionError('protocol')
  return { name: value.name as string, version: value.version as string, ...(typeof value.title === 'string' ? { title: value.title } : {}) }
}
const completeResult = (message: Record<string, unknown> | undefined) => {
  if (!message || Object.hasOwn(message, 'error') || !object(message.result)) throw new McpSessionError('protocol')
  if (message.result.resultType === 'input_required') throw new McpSessionError('input_required')
  if (message.result.resultType !== undefined && message.result.resultType !== 'complete') throw new McpSessionError('protocol')
  return message.result
}

/** Internal callback scope, not a persisted or renderer-visible session handle.
 * Injected transports must honor AbortSignal like the real HTTP transport. */
export function createMcpSession({ post = postMcpHttp, now = () => performance.now() } = {}) {
  return async <T>(endpoint: string, options: McpSessionOptions, run: (session: McpSession) => Promise<T>): Promise<McpSessionDetails & { value: T; cleanup: McpSessionCleanup }> => {
    const input = { ...options }
    const timeoutMs = input.timeoutMs ?? 30_000
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) throw new McpHttpError('request', false)
    if (input.signal?.aborted) throw new McpHttpError('cancelled', false)
    const started = now()
    const controller = new AbortController()
    let timedOut = false
    let submitted = false
    let active = true
    let toolAttempted = false
    let listPhase: 'opening' | 'ready' | 'listing' | 'expired' | 'failed' = 'opening'
    let restarted = false
    let cancellationController: AbortController | undefined
    const stop = () => {
      controller.abort()
      if (timedOut) cancellationController?.abort()
    }
    input.signal?.addEventListener('abort', stop, { once: true })
    const timer = setTimeout(() => { timedOut = true; stop() }, timeoutMs)
    const remaining = () => Math.max(0, Math.floor(timeoutMs - (now() - started)))
    const available = (mayHaveExecuted: boolean) => {
      const left = remaining()
      if (controller.signal.aborted || !left) throw new McpHttpError(timedOut || !left ? 'timeout' : 'cancelled', mayHaveExecuted)
      return left
    }
    let protocolVersion: McpProtocolVersion = MCP_MODERN_VERSION
    let sessionId: string | undefined
    let useLegacy = false
    let serial = 0
    const requestPrefix = randomUUID()
    const exchange = async (message: Record<string, unknown> | null, options: McpHttpOptions) => {
      try { return await post(endpoint, message, options) } catch (error) {
        const failure = timedOut && error instanceof McpHttpError && error.code === 'cancelled'
          ? new McpHttpError('timeout', error.mayHaveExecuted, error.status, error.recognizedModernError) : error
        // Only the actual transport knows whether this request was issued and
        // whether cancellation beat its response. A handshake's submission is
        // not evidence that a later tool left DNS, and a fulfilled response is
        // never erased by a late abort. Cancellation is not proof of rollback.
        const left = remaining()
        if (error instanceof McpHttpError && error.code === 'cancelled' && error.mayHaveExecuted &&
          !timedOut && left > 0 && legacy(options.protocolVersion) &&
          (message?.method === 'tools/list' || message?.method === 'tools/call') &&
          (typeof message.id === 'string' || Number.isSafeInteger(message.id))) {
          const cancellation = new AbortController()
          cancellationController = cancellation
          // A separate signal can deliver cancellation after the operation's
          // signal aborted, but never outlive the original transaction budget.
          const cancellationMs = Math.min(MAX_CANCELLATION_MS, left)
          const cancellationTimer = setTimeout(() => cancellation.abort(), cancellationMs)
          try {
            await post(endpoint, { jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: message.id } }, {
              scope: input.scope, bearerToken: input.bearerToken, protocolVersion: options.protocolVersion,
              ...(options.sessionId ? { sessionId: options.sessionId } : {}),
              signal: cancellation.signal, timeoutMs: cancellationMs,
            })
          } catch { /* Best effort only: acknowledgement cannot establish the tool's outcome. */ }
          finally {
            clearTimeout(cancellationTimer)
            cancellation.abort()
            cancellationController = undefined
          }
        }
        throw failure
      }
    }
    const send = async (method: string | null, params: Record<string, unknown> = {}) => {
      const left = available(submitted)
      const message = method === null ? null : {
        jsonrpc: '2.0', ...(method.startsWith('notifications/') ? {} : { id: `${requestPrefix}-${++serial}` }),
        method, params: { ...params, ...mcpRequestMetadata(protocolVersion) },
      }
      submitted = true
      return exchange(message, {
        scope: input.scope, bearerToken: input.bearerToken, signal: controller.signal, timeoutMs: left, protocolVersion,
        ...(protocolVersion !== MCP_MODERN_VERSION && sessionId ? { sessionId } : {}),
      })
    }
    let details: McpSessionDetails
    let value: T
    let cleanup: McpSessionCleanup = 'not-needed'
    const initializeLegacy = async () => {
      // The old credential is never sent to initialize, retained for cleanup,
      // or reused if the replacement handshake fails.
      sessionId = undefined
      const initialized = await send('initialize', { protocolVersion, capabilities: {}, clientInfo: MCP_CLIENT_INFO })
      // Keep a newly issued credential for cleanup even if its handshake is bad.
      sessionId = initialized.sessionId
      const announced = completeResult(initialized.message)
      if (!legacy(announced.protocolVersion)) throw new McpSessionError('unsupported_version')
      protocolVersion = announced.protocolVersion
      if (announced.serverInfo === undefined) throw new McpSessionError('protocol')
      serverInfo(announced.serverInfo)
      await send('notifications/initialized')
      return announced
    }
    const describe = (announced: Record<string, unknown>): McpSessionDetails => {
      if (!object(announced.capabilities) || !object(announced.capabilities.tools)) throw new McpSessionError('tools_unavailable')
      const info = serverInfo(useLegacy ? announced.serverInfo : (object(announced._meta) ? announced._meta['io.modelcontextprotocol/serverInfo'] : undefined))
      return { protocolVersion, ...(info ? { serverInfo: info } : {}) }
    }
    try {
      let initial: Awaited<ReturnType<typeof post>> | undefined
      try { initial = await send('server/discover') } catch (error) {
        if (!(error instanceof McpHttpError) || error.code !== 'response' || error.recognizedModernError ||
          ![400, 404, 405].includes(error.status ?? 0)) throw error
        useLegacy = true
      }
      let announced: Record<string, unknown>
      const rpcError = initial?.message?.error
      if (object(rpcError)) {
        if (rpcError.code === -32022) {
          if (initial?.status !== 400 || !object(rpcError.data) || rpcError.data.requested !== MCP_MODERN_VERSION) throw new McpSessionError('protocol')
          const supported = versions(rpcError.data.supported)
          if (supported.includes(MCP_MODERN_VERSION)) throw new McpSessionError('protocol')
          const selected = MCP_LEGACY_VERSIONS.find((version) => supported.includes(version))
          if (!selected) throw new McpSessionError('unsupported_version')
          protocolVersion = selected
          useLegacy = true
        } else if (isModernMcpErrorCode(rpcError.code) || initial?.status === 404) throw new McpSessionError('protocol')
        else if ([400, 405].includes(initial?.status ?? 0)) useLegacy = true
        else throw new McpSessionError('protocol')
      }
      if (useLegacy) {
        if (!legacy(protocolVersion)) protocolVersion = MCP_LEGACY_VERSIONS[0]
        announced = await initializeLegacy()
      } else {
        announced = completeResult(initial?.message)
        if (!versions(announced.supportedVersions).includes(MCP_MODERN_VERSION)) throw new McpSessionError('unsupported_version')
      }
      details = describe(announced)
      listPhase = 'ready'
      const caller = createMcpToolCaller({ post: (_endpoint, message, callOptions) => {
        if (!active) return Promise.reject(new McpHttpError('cancelled', false))
        const left = available(false)
        return exchange(message, { ...callOptions, scope: input.scope, bearerToken: input.bearerToken,
          signal: controller.signal, timeoutMs: left })
      } })
      value = await run({
        get protocolVersion() { return details.protocolVersion },
        get serverInfo() { return details.serverInfo },
        listTools: async (params = {}) => {
          if (!active || toolAttempted || listPhase !== 'ready') throw new McpSessionError('protocol')
          listPhase = 'listing'
          const requestedSession = sessionId
          try {
            const response = await send('tools/list', params)
            const error = response.message?.error
            if (useLegacy && requestedSession && response.status === 404 &&
              !(object(error) && isModernMcpErrorCode(error.code))) {
              throw new McpHttpError('response', true, 404)
            }
            if (response.sessionId && response.sessionId !== sessionId && useLegacy) throw new McpSessionError('protocol')
            const result = completeResult(response.message)
            listPhase = 'ready'
            return result
          } catch (error) {
            if (useLegacy && requestedSession && error instanceof McpHttpError &&
              error.code === 'response' && error.status === 404 && !error.recognizedModernError) {
              sessionId = undefined
              listPhase = 'expired'
              throw new McpSessionError('session_expired')
            }
            listPhase = 'failed'
            throw error
          }
        },
        restartExpiredSession: async () => {
          if (!active || toolAttempted || listPhase !== 'expired') throw new McpSessionError('protocol')
          if (restarted) throw new McpSessionError('session_expired')
          // Consume the one restart before awaiting; concurrent callers and a
          // failed replacement cannot issue another initialize.
          restarted = true
          listPhase = 'opening'
          try {
            details = describe(await initializeLegacy())
            listPhase = 'ready'
          } catch (error) {
            listPhase = 'failed'
            throw error
          }
        },
        callTool: async (invocation) => {
          if (!active || toolAttempted || listPhase !== 'ready') throw new McpToolCallError('request', false)
          toolAttempted = true
          try {
            return await caller(endpoint, { ...invocation, protocolVersion, ...(sessionId ? { sessionId } : {}) }, {
              scope: input.scope, bearerToken: input.bearerToken, signal: controller.signal, timeoutMs: available(false),
            })
          } catch (error) {
            if (error instanceof McpToolCallError) throw error
            if (error instanceof McpHttpError) throw new McpToolCallError(error.code, error.mayHaveExecuted)
            throw new McpToolCallError('network', true)
          }
        },
      })
    } finally {
      active = false
      if (sessionId) {
        cleanup = 'unconfirmed'
        if (!controller.signal.aborted && remaining() > 0) {
          try { cleanup = (await send(null)).status === 405 ? 'server-managed' : 'released' } catch { /* Preserve the operation's known result or original failure. */ }
        }
      }
      clearTimeout(timer)
      input.signal?.removeEventListener('abort', stop)
      controller.abort()
    }
    return { ...details, value, cleanup }
  }
}
