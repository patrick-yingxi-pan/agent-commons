/** Read-only bounded catalog discovery. Session negotiation/deadline/cleanup
 * share one owner with the unconfigured single-call protocol boundary. */
import { postMcpHttp, McpHttpError, type McpHttpOptions } from './mcpHttpTransport.ts'
import { parseMcpToolsPage, MAX_MCP_DISCOVERY_PAGES, MAX_MCP_DISCOVERY_TOOLS, MAX_MCP_CATALOG_BYTES, type McpDiscoveredTool } from './mcpCatalog.ts'
import { createMcpSession, McpSessionError, type McpSessionCleanup } from './mcpSession.ts'
import type { McpSchemaAdmission } from './mcpToolAdmission.ts'

export { MCP_MODERN_VERSION, MCP_LEGACY_VERSIONS } from './mcpProtocol.ts'
export { MAX_MCP_DISCOVERY_PAGES, MAX_MCP_DISCOVERY_TOOLS, MAX_MCP_CATALOG_BYTES } from './mcpCatalog.ts'

export class McpDiscoveryError extends Error {
  readonly code: McpSessionError['code'] | 'catalog'
  constructor(code: McpDiscoveryError['code']) { super(`MCP discovery failed (${code}).`); this.code = code }
}
export interface McpDiscovery {
  protocolVersion: string
  serverInfo?: { name: string; version: string; title?: string }
  tools: McpDiscoveredTool[]
  cleanup: McpSessionCleanup
  /** Local validation stamp, never populated from a remote response. */
  schemaAdmission?: McpSchemaAdmission
}

export function createMcpDiscovery({ post = postMcpHttp, now = () => performance.now() } = {}) {
  const withSession = createMcpSession({ post, now })
  return async (endpoint: string, options: Pick<McpHttpOptions, 'scope' | 'bearerToken' | 'signal' | 'timeoutMs'>): Promise<McpDiscovery> => {
    const input = { ...options }
    try {
      const { value: tools, ...session } = await withSession(endpoint, input, async (context) => {
        const tools: McpDiscoveredTool[] = []
        const names = new Set<string>()
        const cursors = new Set<string>()
        let cursor: string | undefined
        let totalBytes = 0
        let totalTools = 0
        for (let page = 0; page < MAX_MCP_DISCOVERY_PAGES; page++) {
          let raw: Record<string, unknown>
          try { raw = await context.listTools(cursor ? { cursor } : {}) } catch (error) {
            if (!(error instanceof McpSessionError) || error.code !== 'session_expired') throw error
            if (page + 1 >= MAX_MCP_DISCOVERY_PAGES) throw new McpDiscoveryError('catalog')
            await context.restartExpiredSession()
            // A cursor/catalog belongs to its session, not the endpoint URL.
            // Discard its projection, but never replenish transaction budgets.
            tools.length = 0
            names.clear()
            cursors.clear()
            cursor = undefined
            continue
          }
          totalBytes += new TextEncoder().encode(JSON.stringify(raw)).byteLength
          if (totalBytes > MAX_MCP_CATALOG_BYTES) throw new McpDiscoveryError('catalog')
          let parsed: ReturnType<typeof parseMcpToolsPage>
          try { parsed = parseMcpToolsPage(raw) } catch { throw new McpDiscoveryError('catalog') }
          for (const tool of parsed.tools) {
            if (names.has(tool.name) || totalTools >= MAX_MCP_DISCOVERY_TOOLS) throw new McpDiscoveryError('catalog')
            totalTools += 1
            names.add(tool.name)
            tools.push(tool)
          }
          cursor = parsed.nextCursor
          if (!cursor) return tools
          if (cursors.has(cursor)) throw new McpDiscoveryError('catalog')
          cursors.add(cursor)
        }
        throw new McpDiscoveryError('catalog')
      })
      // Unlike an executed tool's known result, a cancelled read-only inspection
      // must not become an acknowledged catalog merely because cleanup began.
      if (input.signal?.aborted) throw new McpHttpError('cancelled', true)
      return { ...session, tools }
    } catch (error) {
      if (error instanceof McpSessionError) throw new McpDiscoveryError(error.code)
      throw error
    }
  }
}

export const discoverMcpTools = createMcpDiscovery()
