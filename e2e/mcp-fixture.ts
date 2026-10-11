import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import { configureMcpRuntime, initializeMcpRuntime, mcpRuntimeConfiguration, type McpRuntimeConfiguration } from '../server/mcpRuntime.ts'
import { sendError } from '../server/http/respond.ts'
import type { Router } from '../server/http/router.ts'
import type { Page, Route } from '@playwright/test'

const TEST_MODEL_PORT = 8830 + Number(process.env.E2E_SHARD ?? 0)
const TEST_MODEL_BASE_URL = `http://127.0.0.1:${TEST_MODEL_PORT}`

function restoreEnv(name: 'AUTH_GATE' | 'ANTHROPIC_BASE_URL' | 'MODEL_PORT', value: string | undefined) {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

/** Only the event stream is intentionally absent in this request/ack fixture.
 * Ordinary HTTP failures remain loud rather than silently hanging a route. */
export async function proxyMcpApi(page: Page, stack: { url: string }) {
  const pattern = '**/api/v1/**'
  const handler = async (route: Route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/api/v1/events') {
      await route.abort()
      return
    }
    const { origin: _origin, ...headers } = route.request().headers()
    const response = await route.fetch({ url: `${stack.url}${url.pathname}${url.search}`, headers })
    const body = await response.body()
    await route.fulfill({ status: response.status(), headers: response.headers(), body })
  }
  await page.route(pattern, handler)
  // The page and its loss/hold routes belong to this fixture. Drain all active
  // handlers before their server or Playwright response context is disposed.
  return () => page.unrouteAll({ behavior: 'wait' })
}

export interface McpFixture {
  url: string
  calls: string[]
  authorization: string[]
  toolCalls: Array<{ name: string; arguments: Record<string, unknown> }>
  setToolBehavior(behavior: 'success' | 'error' | 'uncertain'): void
  server: ReturnType<typeof createServer>
  close(): Promise<void>
}

export interface McpRouterStack {
  url: string
  router: Router
  server: ReturnType<typeof createServer>
  setCleanupAvailable(available: boolean): void
  close(): Promise<void>
}

/** Build the real router in this test worker, with loopback admission scoped to
 * this in-memory fixture only. The browser spec proxies API calls here, so the
 * production webServer remains untouched and production launch defaults stay
 * public-only. */
export async function startMcpRouterStack(options: {
  cleanupAvailable?: boolean
  deviceBearerAvailable?: boolean
  resolveCredential?: (reference: string, binding: { tenantId: string; connectionId: string; endpoint: string }) => Promise<string>
  deviceOAuthAvailable?: boolean
  resolveOAuthCredential?: (reference: string, binding: { tenantId: string; connectionId: string; endpoint: string }, ownerUserId: string) => Promise<string>
  localProcessesAvailable?: boolean
  openStdio?: McpRuntimeConfiguration['openStdio']
  synchronizeStdioBindings?: McpRuntimeConfiguration['synchronizeStdioBindings']
} = {}): Promise<McpRouterStack> {
  const previousAuth = process.env.AUTH_GATE
  const previousModelBaseUrl = process.env.ANTHROPIC_BASE_URL
  const previousModelPort = process.env.MODEL_PORT
  const previousRuntime = mcpRuntimeConfiguration()
  let cleanupAvailable = options.cleanupAvailable ?? true
  let restored = false
  const restoreProcessState = () => {
    if (restored) return
    restored = true
    configureMcpRuntime(previousRuntime)
    restoreEnv('AUTH_GATE', previousAuth)
    restoreEnv('ANTHROPIC_BASE_URL', previousModelBaseUrl)
    restoreEnv('MODEL_PORT', previousModelPort)
  }
  // The browser harness impersonates the seeded default tenant through the
  // same dev identity seam as the normal E2E stack; do not enable the real
  // sign-in wall in this in-memory test process.
  process.env.AUTH_GATE = 'off'
  // `playwright.config.ts` gives these values to its webServer child, not to
  // this test-worker process. Pin the router built below to that same
  // shard-owned mock so an ambient developer endpoint cannot mask a missing
  // model in CI (and an ambient production endpoint can never receive E2E data).
  process.env.MODEL_PORT = String(TEST_MODEL_PORT)
  process.env.ANTHROPIC_BASE_URL = TEST_MODEL_BASE_URL
  let server: ReturnType<typeof createServer> | undefined
  try {
    configureMcpRuntime({
      deviceBearerAvailable: options.deviceBearerAvailable ?? false,
      deviceOAuthAvailable: options.deviceOAuthAvailable ?? false,
      allowLoopback: true,
      resolveCredential: options.resolveCredential,
      resolveOAuthCredential: options.resolveOAuthCredential,
      localProcessesAvailable: options.localProcessesAvailable,
      openStdio: options.openStdio,
      synchronizeStdioBindings: options.synchronizeStdioBindings,
      synchronizeBindings: async () => ({ available: cleanupAvailable }),
    })
    if (options.deviceOAuthAvailable || options.localProcessesAvailable) await initializeMcpRuntime([])
    const { buildRouter } = await import('../server/routes/index.ts')
    const router = buildRouter()
    server = createServer(async (request, response) => {
      // This test-only hop is driven by Playwright's pooled route.fetch client.
      // A reload after the viewport sweep can race Node's idle socket expiry.
      // Own one exchange per connection rather than retrying a possibly
      // effectful request or changing any production/test timing budget.
      response.setHeader('connection', 'close')
      const raw = request.url ?? '/'
      const url = new URL(raw, 'http://127.0.0.1')
      if (url.pathname.startsWith('/api/v1/')) url.pathname = url.pathname.slice('/api/v1'.length)
      const handled = await router.handle(request, response, url)
      if (!handled && !response.writableEnded) sendError(response, 'not_found', `No route ${request.method} ${url.pathname}`)
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('MCP router stack did not bind a TCP port')
    return {
      url: `http://127.0.0.1:${address.port}`,
      router, server,
      setCleanupAvailable: available => { cleanupAvailable = available },
      close: async () => {
        try {
          server!.closeAllConnections()
          await new Promise<void>((resolve) => server!.close(() => resolve()))
        } finally {
          restoreProcessState()
        }
      },
    }
  } catch (error) {
    server?.closeAllConnections()
    server?.close()
    restoreProcessState()
    throw error
  }
}

/** Test-owned modern Streamable HTTP peer. It advertises metadata only; no
 * tool is ever executed by the product during catalog inspection. */
export async function startMcpFixture(options: {
  label?: string
  toolName?: string
  description?: string
  schemaPadding?: number
  empty?: boolean
  fail?: boolean
  expectedBearer?: string
  toolBehavior?: 'success' | 'error' | 'uncertain'
  resultResourceName?: string
  resultMimeType?: string
  /** Test-owned peer response, including bounded multi-round input requests. */
  toolResult?: (params: Record<string, unknown>, callIndex: number) => unknown
} = {}): Promise<McpFixture> {
  const calls: string[] = []
  const authorization: string[] = []
  const toolCalls: Array<{ name: string; arguments: Record<string, unknown> }> = []
  let toolBehavior = options.toolBehavior ?? 'success'
  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    let body: { id?: string; method?: string; params?: { name?: unknown; arguments?: unknown } }
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as typeof body } catch {
      response.writeHead(400, { 'content-type': 'application/json' }); response.end('{}'); return
    }
    calls.push(body.method ?? '')
    authorization.push(typeof request.headers.authorization === 'string' ? request.headers.authorization : '')
    if (options.expectedBearer && request.headers.authorization !== `Bearer ${options.expectedBearer}`) {
      response.writeHead(401, { 'content-type': 'application/json' }); response.end('{}'); return
    }
    if (options.fail) {
      response.writeHead(503, { 'content-type': 'application/json' }); response.end(JSON.stringify({ error: 'fixture failure' })); return
    }
    const tool = {
      name: options.toolName ?? 'inspect_records',
      description: options.description ?? 'Read-only fixture catalog entry.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', maxLength: 256 },
          ...Object.fromEntries(Array.from({ length: Math.max(0, Math.min(100, options.schemaPadding ?? 0)) }, (_, index) => [`detail_${String(index + 1).padStart(3, '0')}`, { type: 'string', description: `Optional long-schema fixture field ${index + 1}; this text makes the read-only schema region overflow for keyboard-scroll verification.` }])),
        },
        required: ['query'],
        additionalProperties: false,
      },
    }
    if (body.method === 'tools/call') {
      const name = typeof body.params?.name === 'string' ? body.params.name : ''
      const args = body.params?.arguments && typeof body.params.arguments === 'object' && !Array.isArray(body.params.arguments)
        ? body.params.arguments as Record<string, unknown>
        : {}
      toolCalls.push({ name, arguments: structuredClone(args) })
      if (toolBehavior === 'uncertain') {
        response.destroy()
        return
      }
      const result = options.toolResult ? options.toolResult(body.params as Record<string, unknown>, toolCalls.length)
        : toolBehavior === 'error'
        ? { resultType: 'complete', isError: true, content: [{ type: 'text', text: 'Fixture rejected the requested operation.' }] }
        : {
            resultType: 'complete',
            isError: false,
            content: [
              { type: 'text', text: `Fixture result for ${String(args.query ?? '')}.` },
              { type: 'image', data: 'AA==', mimeType: 'image/png' },
              { type: 'resource_link', uri: 'https://fixture.example/report', name: options.resultResourceName ?? 'Fixture report', mimeType: options.resultMimeType ?? 'text/plain', size: 42 },
            ],
            structuredContent: { matched: 1, query: args.query ?? null },
          }
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }))
      return
    }
    const result = body.method === 'server/discover'
      ? { supportedVersions: ['2026-07-28'], capabilities: { tools: {} }, _meta: {
          'io.modelcontextprotocol/serverInfo': { name: options.label ?? 'Fixture peer', version: '1.0.0' },
        } }
      : body.method === 'tools/list'
        ? { tools: options.empty ? [] : [tool] }
        : {}
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('MCP fixture did not bind a TCP port')
  return {
    url: `http://127.0.0.1:${address.port}/mcp`, calls, authorization, toolCalls, server,
    setToolBehavior: behavior => { toolBehavior = behavior },
    close: async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())) },
  }
}
