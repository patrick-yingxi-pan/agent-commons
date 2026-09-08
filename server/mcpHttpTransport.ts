/** Outbound MCP transport substrate, not a configured integration. Callers must
 * bind the endpoint and scope to explicit user consent before using this door.
 * No redirects, environment proxy, cookies, automatic retries or TLS override.
 * Protocol negotiation, discovery, durable call receipts and UI live above it. */
import { request as httpRequest, type ClientRequest, type IncomingMessage, type RequestOptions } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { isPublicAddress, parseOutboundEndpoint } from './outboundAddress.ts'
import { createMcpSseDecoder, MAX_MCP_RESPONSE_BYTES, McpResponseError, parseRpcResponse } from './mcpHttpResponse.ts'
import { buildMcpParameterHeaders, encodeMcpHeaderValue, parseMcpHeaderParameters } from './mcpHeaderParameters.ts'
import { snapshotMcpJson } from './mcpJson.ts'

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
}
const MAX_REQUEST_BYTES = 65_536
const DEFAULT_TIMEOUT_MS = 10_000
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
      let settled = false
      let dispatched = false
      let responseStatus: number | undefined
      let recognizedModernError = false
      let request: ClientRequest | undefined
      let response: IncomingMessage | undefined
      const finish = (error?: McpHttpFailure, reply?: Reply) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
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
        const socketOptions: RequestOptions = {
          method: message === null ? 'DELETE' : 'POST', headers, agent: false, autoSelectFamily: false,
          family: pinnedFamily, maxHeaderSize: 16_384,
          rejectUnauthorized: true,
          lookup: (_host, _options, callback) => callback(null, address, pinnedFamily),
        }
        request = (url.protocol === 'https:' ? https : http)(url, socketOptions, (incoming) => {
          response = incoming
          incoming.on('error', () => finish('network'))
          incoming.on('close', () => { if (!settled && !incoming.complete) finish('network') })
          if (settled) { incoming.destroy(); return }
          const status = incoming.statusCode ?? 0
          responseStatus = status
          if (status >= 300 && status < 400) return finish('redirect')
          if (status === 401 || status === 403) return finish('authentication')
          const sessionId = incoming.headers['mcp-session-id']
          if (sessionId !== undefined && (typeof sessionId !== 'string' || !safeHeader(sessionId, 256))) return finish('response')
          const replyBase = { status, ...(typeof sessionId === 'string' ? { sessionId } : {}) }
          if (message === null) return [200, 202, 204, 404, 405].includes(status) ? finish(undefined, { status }) : finish('response')
          const acceptResponse = (result: Record<string, unknown>) => {
            if ((status < 200 || status >= 300) && Object.hasOwn(result, 'result')) return finish('response')
            finish(undefined, { ...replyBase, message: result })
          }
          if (message.id === undefined) return status === 202 ? finish(undefined, replyBase) : finish('response')
          const encoding = incoming.headers['content-encoding']
          if (encoding !== undefined && encoding !== 'identity') return finish('response')
          const contentType = incoming.headers['content-type']
          const media = typeof contentType === 'string' ? contentType.split(';')[0]!.trim().toLowerCase() : ''
          if (media !== 'application/json' && media !== 'text/event-stream') return finish('response')
          const declared = incoming.headers['content-length']
          if (declared !== undefined && (typeof declared !== 'string' || !/^\d+$/.test(declared) || Number(declared) > MAX_MCP_RESPONSE_BYTES)) return finish('response')
          const decoder = new TextDecoder('utf-8', { fatal: true })
          const sse = media === 'text/event-stream' ? createMcpSseDecoder(message.id as string | number) : undefined
          let bytes = 0
          let text = ''
          incoming.on('data', (chunk) => {
            if (settled) return
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
            if (settled) return
            try {
              const tail = decoder.decode()
              if (sse) { sse.push(tail); sse.end() }
              acceptResponse(parseRpcResponse(text + tail, message.id as string | number, status >= 400))
            } catch (error) {
              recognizedModernError = error instanceof McpResponseError && error.recognizedModernError
              finish('response')
            }
          })
        })
        request.on('error', () => finish('network'))
        request.on('upgrade', (_response, socket) => { socket.destroy(); finish('response') })
        if (settled) { request.destroy(); return }
        // Once submitted, a timeout or lost response cannot prove no effect.
        // Callers must persist uncertainty rather than automatically retry.
        dispatched = true
        request.end(body)
      }).catch(() => finish('network'))
    })
  }
}

export const postMcpHttp = createMcpHttpTransport()
