/** A read-only MCP discovery transaction. It never calls a tool, adopts server
 * instructions, opens a server-provided URL, or publishes a partial catalog.
 * Connection ownership, credential custody and execution approval live above it. */
import { postMcpHttp, McpHttpError, type McpHttpOptions } from './mcpHttpTransport.ts'
import { randomUUID } from 'node:crypto'
import { parseMcpToolsPage, type McpDiscoveredTool } from './mcpCatalog.ts'
import { isModernMcpErrorCode } from './mcpHttpResponse.ts'

export const MCP_MODERN_VERSION = '2026-07-28'
export const MCP_LEGACY_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'] as const
export const MAX_MCP_DISCOVERY_PAGES = 8
export const MAX_MCP_DISCOVERY_TOOLS = 128
export const MAX_MCP_CATALOG_BYTES = 524_288
const CLIENT_INFO = { name: 'agent-commons', version: '0.1.0' }

export class McpDiscoveryError extends Error {
  readonly code: 'protocol' | 'unsupported_version' | 'tools_unavailable' | 'catalog' | 'input_required'
  constructor(code: McpDiscoveryError['code']) {
    super(`MCP discovery failed (${code}).`)
    this.code = code
  }
}
export interface McpDiscovery {
  protocolVersion: string
  serverInfo?: { name: string; version: string; title?: string }
  tools: McpDiscoveredTool[]
  /** Legacy sessions are closed after inspection; no session credential escapes. */
  cleanup: 'not-needed' | 'released' | 'server-managed' | 'unconfirmed'
}
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const legacy = (version: unknown): version is typeof MCP_LEGACY_VERSIONS[number] =>
  MCP_LEGACY_VERSIONS.some((supported) => supported === version)
const versions = (value: unknown): string[] => {
  if (!Array.isArray(value) || !value.length || value.length > 16 ||
    value.some((item) => typeof item !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(item))) throw new McpDiscoveryError('protocol')
  return value as string[]
}
const serverInfo = (value: unknown): McpDiscovery['serverInfo'] => {
  if (value === undefined) return undefined
  const text = (entry: unknown) => typeof entry === 'string' && entry.length > 0 && entry.length <= 256 && !/[\u0000-\u001f\u007f]/.test(entry)
  if (!object(value) || !text(value.name) || !text(value.version) ||
    (value.title !== undefined && !text(value.title))) throw new McpDiscoveryError('protocol')
  return { name: value.name as string, version: value.version as string,
    ...(typeof value.title === 'string' ? { title: value.title } : {}) }
}
const completeResult = (message: Record<string, unknown> | undefined) => {
  if (!message || Object.hasOwn(message, 'error') || !object(message.result)) throw new McpDiscoveryError('protocol')
  if (message.result.resultType === 'input_required') throw new McpDiscoveryError('input_required')
  if (message.result.resultType !== undefined && message.result.resultType !== 'complete') throw new McpDiscoveryError('protocol')
  return message.result
}

/** Internal injection tests real protocol state transitions without granting
 * callers a configurable transport, resolver, or credential lookup path. */
export function createMcpDiscovery({ post = postMcpHttp, now = () => performance.now() } = {}) {
  return async (endpoint: string, options: Pick<McpHttpOptions, 'scope' | 'bearerToken' | 'signal' | 'timeoutMs'>): Promise<McpDiscovery> => {
    const input = { ...options }
    const timeoutMs = input.timeoutMs ?? 30_000
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) throw new McpHttpError('request', false)
    if (input.signal?.aborted) throw new McpHttpError('cancelled', false)
    const started = now()
    const controller = new AbortController()
    let timeout = false
    let submitted = false
    let rejectStopped!: (error: McpHttpError) => void
    const stopped = new Promise<never>((_resolve, reject) => { rejectStopped = reject })
    // A rejected stop signal may precede the first awaited request.
    void stopped.catch(() => {})
    const stop = () => {
      rejectStopped(new McpHttpError(timeout ? 'timeout' : 'cancelled', submitted))
      controller.abort()
    }
    input.signal?.addEventListener('abort', stop, { once: true })
    const timer = setTimeout(() => { timeout = true; stop() }, timeoutMs)
    let protocolVersion: string = MCP_MODERN_VERSION
    let sessionId: string | undefined
    let serial = 0
    const requestPrefix = randomUUID()
    const remaining = () => Math.max(0, Math.floor(timeoutMs - (now() - started)))
    const send = async (method: string | null, params: Record<string, unknown> = {}) => {
      const left = remaining()
      if (controller.signal.aborted || !left) throw new McpHttpError(timeout || !left ? 'timeout' : 'cancelled', submitted)
      const modern = protocolVersion === MCP_MODERN_VERSION
      const meta = modern ? { _meta: {
        'io.modelcontextprotocol/protocolVersion': protocolVersion,
        'io.modelcontextprotocol/clientInfo': CLIENT_INFO,
        'io.modelcontextprotocol/clientCapabilities': {},
      } } : {}
      const message = method === null ? null : {
        jsonrpc: '2.0', ...(method.startsWith('notifications/') ? {} : { id: `${requestPrefix}-${++serial}` }),
        method, params: { ...params, ...meta },
      }
      submitted = true
      return Promise.race([stopped, post(endpoint, message, {
        scope: input.scope, bearerToken: input.bearerToken,
        signal: controller.signal, timeoutMs: left, protocolVersion,
        ...(!modern && sessionId ? { sessionId } : {}),
      })])
    }
    let result: McpDiscovery | undefined
    try {
      let initial: Awaited<ReturnType<typeof post>> | undefined
      let useLegacy = false
      try { initial = await send('server/discover') } catch (error) {
        // Only an explicit legacy-shaped HTTP refusal permits a handshake.
        // Authentication, redirects, DNS, timeout and network faults never do.
        if (!(error instanceof McpHttpError) || error.code !== 'response' || error.recognizedModernError ||
          ![400, 404, 405].includes(error.status ?? 0)) throw error
        useLegacy = true
      }
      let announced: Record<string, unknown>
      const rpcError = initial?.message?.error
      if (object(rpcError)) {
        if (rpcError.code === -32022) {
          if (initial?.status !== 400 || !object(rpcError.data) || rpcError.data.requested !== MCP_MODERN_VERSION) {
            throw new McpDiscoveryError('protocol')
          }
          const supported = versions(object(rpcError.data) ? rpcError.data.supported : undefined)
          if (supported.includes(MCP_MODERN_VERSION)) throw new McpDiscoveryError('protocol')
          const selected = MCP_LEGACY_VERSIONS.find((version) => supported.includes(version))
          if (!selected) throw new McpDiscoveryError('unsupported_version')
          protocolVersion = selected
          useLegacy = true
        } else if (isModernMcpErrorCode(rpcError.code) || initial?.status === 404) {
          throw new McpDiscoveryError('protocol')
        } else if ([400, 405].includes(initial?.status ?? 0)) useLegacy = true
        else throw new McpDiscoveryError('protocol')
      }
      if (useLegacy) {
        if (!legacy(protocolVersion)) protocolVersion = MCP_LEGACY_VERSIONS[0]
        const initialized = await send('initialize', { protocolVersion, capabilities: {}, clientInfo: CLIENT_INFO })
        // Retain the opaque session only for this transaction and cleanup.
        sessionId = initialized.sessionId
        announced = completeResult(initialized.message)
        if (!legacy(announced.protocolVersion)) throw new McpDiscoveryError('unsupported_version')
        protocolVersion = announced.protocolVersion
        if (announced.serverInfo === undefined) throw new McpDiscoveryError('protocol')
        serverInfo(announced.serverInfo)
        await send('notifications/initialized')
      } else {
        announced = completeResult(initial?.message)
        if (!versions(announced.supportedVersions).includes(MCP_MODERN_VERSION)) throw new McpDiscoveryError('unsupported_version')
      }
      if (!object(announced.capabilities) || !object(announced.capabilities.tools)) throw new McpDiscoveryError('tools_unavailable')
      const info = serverInfo(useLegacy ? announced.serverInfo :
        (object(announced._meta) ? announced._meta['io.modelcontextprotocol/serverInfo'] : undefined))
      const tools: McpDiscoveredTool[] = []
      const names = new Set<string>()
      const cursors = new Set<string>()
      let cursor: string | undefined
      let totalBytes = 0
      for (let page = 0; page < MAX_MCP_DISCOVERY_PAGES; page++) {
        const response = await send('tools/list', cursor ? { cursor } : {})
        // Legacy session rotation is not part of a discovery response.
        if (response.sessionId && response.sessionId !== sessionId && useLegacy) throw new McpDiscoveryError('protocol')
        const raw = completeResult(response.message)
        totalBytes += new TextEncoder().encode(JSON.stringify(raw)).byteLength
        if (totalBytes > MAX_MCP_CATALOG_BYTES) throw new McpDiscoveryError('catalog')
        let parsed: ReturnType<typeof parseMcpToolsPage>
        try { parsed = parseMcpToolsPage(raw) } catch { throw new McpDiscoveryError('catalog') }
        for (const tool of parsed.tools) {
          if (names.has(tool.name) || tools.length >= MAX_MCP_DISCOVERY_TOOLS) throw new McpDiscoveryError('catalog')
          names.add(tool.name)
          tools.push(tool)
        }
        cursor = parsed.nextCursor
        if (!cursor) {
          result = { protocolVersion, ...(info ? { serverInfo: info } : {}), tools, cleanup: 'not-needed' }
          return result
        }
        if (cursors.has(cursor)) throw new McpDiscoveryError('catalog')
        cursors.add(cursor)
      }
      throw new McpDiscoveryError('catalog')
    } finally {
      if (sessionId) {
        if (result) result.cleanup = 'unconfirmed'
        if (!controller.signal.aborted && remaining() > 0) {
          try {
            const closed = await send(null)
            if (result) result.cleanup = closed.status === 405 ? 'server-managed' : 'released'
          } catch { /* Cleanup cannot convert a failed discovery into success. */ }
        }
      }
      clearTimeout(timer)
      input.signal?.removeEventListener('abort', stop)
      if (input.signal?.aborted) throw new McpHttpError('cancelled', submitted)
    }
  }
}

export const discoverMcpTools = createMcpDiscovery()
