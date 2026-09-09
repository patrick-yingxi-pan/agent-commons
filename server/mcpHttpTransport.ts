/** Outbound MCP transport substrate, not a configured integration. Callers must
 * bind the endpoint and scope to explicit user consent before using this door.
 * No redirects, environment proxy, cookies, RPC replay or TLS override. Legacy
 * response streams may resume through bounded read-only GETs, never a new POST.
 * Protocol negotiation, discovery, durable call receipts and UI live above it. */
import { request as httpRequest, type ClientRequest, type IncomingMessage, type RequestOptions } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { isPublicAddress, parseOutboundEndpoint } from './outboundAddress.ts'
import { createMcpSseDecoder, MAX_MCP_RESPONSE_BYTES, MAX_MCP_SSE_LAST_EVENT_ID_BYTES, McpResponseError, parseRpcResponse, type McpSseResumeState } from './mcpHttpResponse.ts'
import { buildMcpParameterHeaders, encodeMcpHeaderValue, parseMcpHeaderParameters } from './mcpHeaderParameters.ts'
import { snapshotMcpJson } from './mcpJson.ts'
import { MCP_LEGACY_VERSIONS } from './mcpProtocol.ts'

export type McpHttpFailure = 'destination' | 'request' | 'timeout' | 'cancelled' | 'network' | 'response' | 'redirect' | 'authentication'
export class McpHttpError extends Error {
  readonly code: McpHttpFailure
  readonly mayHaveExecuted: boolean
  readonly status?: number
  readonly recognizedModernError: boolean
  constructor(code: McpHttpFailure, mayHaveExecuted: boolean, status?: number, recognizedModernError = false) {
    super(`MCP transport failed (${code}).`)
    this.code = code
    this.mayHaveExecuted = mayHaveExecuted
    this.status = status
    this.recognizedModernError = recognizedModernError
  }
}

interface Address { address: string; family: number }
interface Reply { status: number; message?: Record<string, unknown>; sessionId?: string }
export interface McpHttpOptions {
  scope: 'public' | 'loopback'
  signal?: AbortSignal
  timeoutMs?: number
  protocolVersion?: string
  sessionId?: string
  /** A write-only caller-owned credential. It is never included in errors. */
  bearerToken?: string
  /** Required for modern tools/call. Headers are derived from this reviewed
   * schema and the actual body, never supplied as arbitrary caller headers. */
  toolInputSchema?: Record<string, unknown>
  /** Synchronous final authority fence after DNS admission and immediately
   * before the initial POST is constructed. Never runs for DELETE or SSE GET. */
  beforeDispatch?: () => void
}
const MAX_REQUEST_BYTES = 65_536
const DEFAULT_TIMEOUT_MS = 10_000
export const MAX_MCP_RESUMPTIONS = 8
const DEFAULT_RETRY_MS = 1_000
const safeHeader = (value: string, max: number) => value.length > 0 && value.length <= max && /^[\x21-\x7e]+$/.test(value)

/** Factory injection is for transport tests, not user configuration. Production
 * always uses system DNS once, validates every answer, then pins that address
 * into the actual socket lookup while retaining the original TLS hostname. */
export function createMcpHttpTransport({
  resolve = (host: string): Promise<Address[]> => lookup(host, { all: true, verbatim: true }),
  http = httpRequest,
  https = httpsRequest,
} = {}) {
  // null is the explicit legacy-session DELETE operation, never an RPC body.
  return (endpoint: string, message: Record<string, unknown> | null, options: McpHttpOptions): Promise<Reply> => {
    options = { ...options }
    let url: URL
    try { url = parseOutboundEndpoint(endpoint, options.scope) } catch { return Promise.reject(new McpHttpError('destination', false)) }
    let body: Uint8Array
    const headers: Record<string, string> = {
      'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
      'Accept-Encoding': 'identity',
    }
    try {
      message = snapshotMcpJson(message, { maxBytes: MAX_REQUEST_BYTES, maxDepth: 40, maxNodes: 8192 }) as Record<string, unknown> | null
      if (message === null) {
        if (!options.sessionId) throw new Error()
        body = new Uint8Array()
      } else {
        if (message.jsonrpc !== '2.0' || typeof message.method !== 'string' || !message.method ||
          Object.keys(message).some((key) => !['jsonrpc', 'id', 'method', 'params'].includes(key)) ||
          (message.params !== undefined && (!message.params || typeof message.params !== 'object' || Array.isArray(message.params))) ||
          (message.id !== undefined && typeof message.id !== 'string' && !Number.isSafeInteger(message.id))) throw new Error()
        body = new TextEncoder().encode(JSON.stringify(message))
        if (body.byteLength > MAX_REQUEST_BYTES) throw new Error()
      }
      if (options.protocolVersion !== undefined) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(options.protocolVersion)) throw new Error()
        headers['MCP-Protocol-Version'] = options.protocolVersion
      }
      if (options.protocolVersion === '2026-07-28') {
        if (!message || options.sessionId !== undefined ||
          !['server/discover', 'tools/list', 'tools/call'].includes(message.method as string)) throw new Error()
        const params = message.params as Record<string, unknown> | undefined
        const meta = params?._meta as Record<string, unknown> | undefined
        if (meta?.['io.modelcontextprotocol/protocolVersion'] !== options.protocolVersion) throw new Error()
        headers['Mcp-Method'] = message.method as string
        if (message.method === 'tools/call') {
          if (message.id === undefined || typeof params?.name !== 'string' || !params.name || Array.from(params.name).length > 128 ||
            !params.arguments || typeof params.arguments !== 'object' || Array.isArray(params.arguments) ||
            !options.toolInputSchema) throw new Error()
          headers['Mcp-Name'] = encodeMcpHeaderValue(params.name)
          Object.assign(headers, buildMcpParameterHeaders(parseMcpHeaderParameters(options.toolInputSchema), params.arguments))
        }
      }
      if (options.toolInputSchema !== undefined && (options.protocolVersion !== '2026-07-28' || message?.method !== 'tools/call')) throw new Error()
      if (options.sessionId !== undefined) {
        if (!safeHeader(options.sessionId, 256)) throw new Error()
        headers['Mcp-Session-Id'] = options.sessionId
      }
      if (options.bearerToken !== undefined) {
        if (!safeHeader(options.bearerToken, 16_384)) throw new Error()
        headers.Authorization = `Bearer ${options.bearerToken}`
      }
      headers['Content-Length'] = String(body.byteLength)
      if (Object.entries(headers).reduce((bytes, [name, value]) => bytes + new TextEncoder().encode(`${name}: ${value}\r\n`).byteLength, 0) > 32_768) throw new Error()
    } catch { return Promise.reject(new McpHttpError('request', false)) }
    const deadline = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    if (!Number.isSafeInteger(deadline) || deadline < 1 || deadline > 60_000) return Promise.reject(new McpHttpError('request', false))
    if (options.signal?.aborted) return Promise.reject(new McpHttpError('cancelled', false))
    return new Promise((resolveReply, reject) => {
      const started = performance.now()
      let settled = false
      let dispatched = false
      let responseStatus: number | undefined
      let recognizedModernError = false
      let request: ClientRequest | undefined
      let response: IncomingMessage | undefined
      let resumeTimer: ReturnType<typeof setTimeout> | undefined
      let resumptions = 0
      const finish = (error?: McpHttpFailure, reply?: Reply) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        clearTimeout(resumeTimer)
        options.signal?.removeEventListener('abort', abort)
        response?.destroy()
        request?.destroy()
        if (error) reject(new McpHttpError(error, dispatched, responseStatus, recognizedModernError))
        else resolveReply(reply!)
      }
      const abort = () => finish('cancelled')
      const timer = setTimeout(() => finish('timeout'), deadline)
      options.signal?.addEventListener('abort', abort, { once: true })
      const hostname = url.hostname.replace(/^\[|\]$/g, '')
      void Promise.resolve().then(async () => {
        const family = isIP(hostname)
        const addresses = family ? [{ address: hostname, family }] : await resolve(hostname)
        if (settled) return
        if (!addresses.length || addresses.length > 64 || addresses.some((row) =>
          isIP(row.address) !== row.family || ![4, 6].includes(row.family) ||
          (options.scope === 'public' && !isPublicAddress(row.address)))) return finish('destination')
        const { address, family: pinnedFamily } = addresses[0]!
        const resumable = !!message && message.id !== undefined && MCP_LEGACY_VERSIONS.some(version => version === options.protocolVersion)
        let bytes = 0 // The bound covers the original response and every resumed connection.
        let replyBase: Reply | undefined
        let streamSessionId = options.sessionId
        const open = (resume?: McpSseResumeState) => {
          if (settled) return
          if (performance.now() - started >= deadline) return finish('timeout')
          let connectionEnded = false
          let sse: ReturnType<typeof createMcpSseDecoder> | undefined
          let eligible = !!resume
          let currentRequest: ClientRequest | undefined
          let currentResponse: IncomingMessage | undefined
          const live = () => !settled && !connectionEnded
          const recover = (failure: McpHttpFailure) => {
            if (!live()) return
            const state = sse?.resumeState() ?? resume
            if (!eligible || !state?.lastEventId || resumptions >= MAX_MCP_RESUMPTIONS) return finish(failure)
            connectionEnded = true
            currentResponse?.destroy()
            currentRequest?.destroy()
            const left = deadline - (performance.now() - started)
            if (left <= 0) return finish('timeout')
            // Never shorten a server retry interval to fit our deadline. The
            // original timer will settle an operation that cannot resume in time.
            if (state.retryMs >= left) return
            resumptions++
            resumeTimer = setTimeout(() => open(state), state.retryMs)
          }
          const outgoing = { ...headers }
          if (resume) {
            const cursor = Buffer.from(resume.lastEventId, 'utf8')
            // Last-Event-ID is UTF-8 bytes, not the modern Base64 sentinel.
            // Refuse values that HTTP would reject or trim rather than retarget
            // the stream with an altered cursor. IDs are never URLs or errors.
            if (cursor.byteLength > MAX_MCP_SSE_LAST_EVENT_ID_BYTES || /[\x00-\x08\x0a-\x1f\x7f]/.test(resume.lastEventId) || /^[ \t]|[ \t]$/.test(resume.lastEventId)) return finish('response')
            delete outgoing['Content-Type']
            delete outgoing['Content-Length']
            outgoing.Accept = 'text/event-stream'
            outgoing['Cache-Control'] = 'no-store'
            outgoing['Last-Event-ID'] = cursor.toString('latin1')
            if (streamSessionId) outgoing['Mcp-Session-Id'] = streamSessionId
          }
          const socketOptions: RequestOptions = {
            method: resume ? 'GET' : message === null ? 'DELETE' : 'POST', headers: outgoing,
            agent: false, autoSelectFamily: false, family: pinnedFamily, maxHeaderSize: 16_384,
            rejectUnauthorized: true,
            // Every connection keeps the once-validated DNS result and TLS host.
            lookup: (_host, _options, callback) => callback(null, address, pinnedFamily),
          }
          try {
            if (!resume && message !== null) {
              try {
                const guardResult: unknown = options.beforeDispatch?.()
                if (guardResult !== null && (typeof guardResult === 'object' || typeof guardResult === 'function') &&
                  typeof (guardResult as { then?: unknown }).then === 'function') {
                  // This fence must complete synchronously at the socket edge.
                  // Observe a rejected promise without ever treating it as permission.
                  void Promise.resolve(guardResult).catch(() => {})
                  return finish('request')
                }
              } catch { return finish('request') }
              if (!live()) return
            }
            currentRequest = (url.protocol === 'https:' ? https : http)(url, socketOptions, (incoming) => {
              currentResponse = incoming
              incoming.on('error', () => recover('network'))
              incoming.on('close', () => { if (live() && !incoming.complete) recover('network') })
              if (!live()) { incoming.destroy(); return }
              response = incoming
              const status = incoming.statusCode ?? 0
              responseStatus = status
              if (status >= 300 && status < 400) return finish('redirect')
              if (status === 401 || status === 403) return finish('authentication')
              const sessionId = incoming.headers['mcp-session-id']
              if (sessionId !== undefined && (typeof sessionId !== 'string' || !safeHeader(sessionId, 256))) return finish('response')
              if (resume && sessionId !== undefined && sessionId !== streamSessionId) return finish('response')
              if (!resume) {
                replyBase = { status, ...(typeof sessionId === 'string' ? { sessionId } : {}) }
                if (message?.method === 'initialize' && typeof sessionId === 'string') streamSessionId = sessionId
              }
              if (message === null) return [200, 202, 204, 404, 405].includes(status) ? finish(undefined, { status }) : finish('response')
              const acceptResponse = (result: Record<string, unknown>) => {
                if ((status < 200 || status >= 300) && Object.hasOwn(result, 'result')) return finish('response')
                finish(undefined, { ...replyBase!, message: result })
              }
              if (message.id === undefined) return status === 202 ? finish(undefined, replyBase!) : finish('response')
              const encoding = incoming.headers['content-encoding']
              if (encoding !== undefined && encoding !== 'identity') return finish('response')
              const contentType = incoming.headers['content-type']
              const media = typeof contentType === 'string' ? contentType.split(';')[0]!.trim().toLowerCase() : ''
              if (media !== 'application/json' && media !== 'text/event-stream') return finish('response')
              if (resume && (status !== 200 || media !== 'text/event-stream')) return finish('response')
              const declared = incoming.headers['content-length']
              if (declared !== undefined && (typeof declared !== 'string' || !/^\d+$/.test(declared) || Number(declared) > MAX_MCP_RESPONSE_BYTES - bytes)) return finish('response')
              const decoder = new TextDecoder('utf-8', { fatal: true })
              eligible = resumable && status >= 200 && status < 300 && media === 'text/event-stream' &&
                (sessionId === undefined || sessionId === streamSessionId)
              sse = media === 'text/event-stream' ? createMcpSseDecoder(message.id as string | number,
                eligible ? resume ?? { lastEventId: '', retryMs: DEFAULT_RETRY_MS } : undefined) : undefined
              let text = ''
              incoming.on('data', (chunk) => {
                if (!live()) return
                try {
                  if (!(chunk instanceof Uint8Array)) return finish('response')
                  bytes += chunk.byteLength
                  if (bytes > MAX_MCP_RESPONSE_BYTES) return finish('response')
                  const decoded = decoder.decode(chunk, { stream: true })
                  if (sse) {
                    const final = sse.push(decoded)
                    if (final) acceptResponse(final)
                  } else text += decoded
                } catch (error) {
                  recognizedModernError = error instanceof McpResponseError && error.recognizedModernError
                  finish('response')
                }
              })
              incoming.on('end', () => {
                if (!live()) return
                try {
                  const tail = decoder.decode()
                  if (sse) {
                    const final = sse.push(tail)
                    if (final) return acceptResponse(final)
                    return recover('response') // EOF never dispatches an incomplete SSE event.
                  }
                  acceptResponse(parseRpcResponse(text + tail, message.id as string | number, status >= 400))
                } catch (error) {
                  recognizedModernError = error instanceof McpResponseError && error.recognizedModernError
                  finish('response')
                }
              })
            })
            request = currentRequest
            currentRequest.on('error', () => recover('network'))
            currentRequest.on('upgrade', (_response, socket) => { socket.destroy(); if (live()) finish('response') })
            if (!live()) { currentRequest.destroy(); return }
            // Resumption only reads the existing stream. The original RPC body
            // is submitted once; a GET refusal never licenses POST replay.
            if (!resume) dispatched = true
            currentRequest.end(resume ? undefined : body)
          } catch { recover('network') }
        }
        open()
      }).catch(() => finish('network'))
    })
  }
}

export const postMcpHttp = createMcpHttpTransport()
