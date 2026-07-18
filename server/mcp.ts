/** ── The MCP door (access-parity INV-11) ─────────────────────────────────────
 *  Wraps the ENTIRE website as an auth-gated MCP server: `POST /mcp` speaks the
 *  Model Context Protocol (Streamable HTTP transport, stateless — JSON-RPC 2.0:
 *  `initialize`, `ping`, `tools/list`, `tools/call`), and every tool is one HTTP
 *  operation of this same API.
 *
 *  The load-bearing decision — parity BY CONSTRUCTION, not by a parallel
 *  implementation:
 *   • the tool catalog is GENERATED from the live route table (`Router.list()`),
 *     so a route added tomorrow is an MCP tool tomorrow, with no second list to
 *     forget;
 *   • `tools/call` re-enters the SAME router over a synthetic request, so the
 *     full middleware wall — the auth gate's 401, identity resolution (cookie /
 *     bearer / dev seam), tenancy walls, idempotency, capability 409s — applies
 *     to an MCP caller exactly as it applies to the web UI. This module contains
 *     NO authorization logic of its own; if it ever grows some, the parity rule
 *     is broken.
 *  Authentication is the SAME credential as the browser session: sign in with
 *  the `post_auth_login` tool using `transport: 'bearer'`, then present the
 *  returned token as `Authorization: Bearer <token>` (verified by the same
 *  `verifySession` + registry path as the cookie — server/identity.ts).
 *
 *  The few non-tool routes are the ones whose FORM can't be a request/response
 *  tool call (endless SSE streams; the endpoint itself) — enumerated with
 *  reasons in `MCP_EXCLUDED` and locked by `tests/mcp-parity.test.ts` so an
 *  exclusion is a visible, argued decision, never a silent gap. Live streams
 *  remain transport-specific DELIVERY of state the tools can read. */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Router, RouteInfo } from './http/router.ts'
import { BASE_HEADERS } from './http/respond.ts'
import { positiveNumberEnv } from './env.ts'
import { API_BASE_PATH } from '../contract/index.ts'

export const MCP_PROTOCOL_VERSION = '2025-06-18'

/** Routes that are deliberately NOT tools, each with its argued reason. Keyed
 *  `"METHOD /pattern"`. The parity test locks that (a) every route is a tool or
 *  is named here, and (b) nothing is named here that isn't a real route. */
export const MCP_EXCLUDED: ReadonlyMap<string, string> = new Map([
  ['GET /events', 'the ambient SSE stream never ends — a tool call is request/response; the state it pushes is readable through the list/get tools'],
  ['GET /sessions/:id/turns/:turnId/stream', 'SSE resume of a live turn — the send-message tool already returns the full reply stream, parsed'],
  ['GET /relay/poll', 'the session-relay mailbox long-poll — a machine edge with its own rendezvous credential and drain loop (use the relay connector, not this door)'],
  ['POST /mcp', 'the MCP endpoint itself'],
  ['GET /mcp', 'the MCP endpoint itself'],
  ['DELETE /mcp', 'the MCP endpoint itself'],
])

const snake = (s: string) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`).replace(/-/g, '_')

/** Deterministic tool name for a route: `GET /sessions/:id/contexts` →
 *  `get_sessions_by_id_contexts`. Uniqueness is locked by the parity test. */
export function toolNameFor(method: string, pattern: string): string {
  const segs = pattern
    .split('/')
    .filter(Boolean)
    .map((s) => (s === '*' ? 'by_rest' : s.startsWith(':') ? `by_${snake(s.slice(1))}` : snake(s)))
  return [method.toLowerCase(), ...segs].join('_')
}

interface ToolRoute extends RouteInfo {
  name: string
  params: string[]
}

/** The tool-exposed routes, derived fresh from the table each call (the table
 *  is append-only after boot, but deriving lazily keeps this a pure view). */
function toolRoutes(router: Router): ToolRoute[] {
  const out: ToolRoute[] = []
  const seen = new Set<string>()
  for (const { method, pattern } of router.list()) {
    if (MCP_EXCLUDED.has(`${method} ${pattern}`)) continue
    const name = toolNameFor(method, pattern)
    if (seen.has(name)) throw new Error(`MCP tool name collision: ${name} (${method} ${pattern})`)
    seen.add(name)
    const params = pattern
      .split('/')
      .filter(Boolean)
      .map((s) => (s === '*' ? 'rest' : s.startsWith(':') ? s.slice(1) : null))
      .filter((p): p is string => p !== null)
    out.push({ method, pattern, name, params })
  }
  return out
}

function toolDefinition(t: ToolRoute) {
  const properties: Record<string, unknown> = {}
  for (const p of t.params) properties[p] = { type: 'string', description: `Path parameter :${p}` }
  properties.query = {
    type: 'object',
    description: 'Optional query-string parameters.',
    additionalProperties: { type: ['string', 'number', 'boolean'] },
  }
  if (t.method !== 'GET') {
    properties.body = { type: 'object', description: 'JSON request body — shapes follow the HTTP contract (contract/api.ts and siblings).' }
  }
  return {
    name: t.name,
    description:
      `${t.method} ${API_BASE_PATH}${t.pattern} — dispatched through the website's own route table, auth wall, and tenancy checks. ` +
      `Returns {status, body} of the HTTP response.`,
    inputSchema: {
      type: 'object',
      properties,
      required: t.params,
      additionalProperties: false,
    },
  }
}

/** Headers NOT forwarded into the inner dispatch: transport plumbing of the
 *  outer HTTP request. Credentials (authorization, cookie) and the dev identity
 *  seam ARE forwarded — that is the parity: the inner wall sees exactly what
 *  the caller presented. */
const HOP_HEADERS = new Set([
  'host',
  'connection',
  'content-length',
  'content-type',
  'transfer-encoding',
  'accept',
  'accept-encoding',
  'origin',
  'mcp-session-id',
  'mcp-protocol-version',
])

interface InnerResponse {
  status: number
  headers: Record<string, string>
  /** Raw response bytes — text routes decode as UTF-8; binary routes (served
   *  image content) stay bytes so they can ride a tool result as base64. */
  body: Buffer
}

/** Re-enter the router with a synthetic request/response pair (the same
 *  technique the test harness uses to drive the real route table without a
 *  socket). The FULL middleware chain runs again for the inner path — that is
 *  the point. */
function dispatch(
  router: Router,
  method: string,
  url: URL,
  headers: IncomingMessage['headers'],
  body: unknown,
): Promise<InnerResponse> {
  return new Promise((resolvePromise) => {
    const fwd: Record<string, string | string[] | undefined> = {}
    for (const [k, v] of Object.entries(headers)) {
      if (!HOP_HEADERS.has(k.toLowerCase())) fwd[k.toLowerCase()] = v
    }
    if (body !== undefined) fwd['content-type'] = 'application/json'
    const listeners: Record<string, (arg?: unknown) => void> = {}
    let emitted = false
    const req: any = {
      method,
      headers: fwd,
      on(ev: string, cb: (arg?: unknown) => void) {
        listeners[ev] = cb
        // Emit the body once the reader attaches its `end` listener (readBody
        // adds `data` first, then `end`) — same contract as the real stream.
        if (ev === 'end' && !emitted) {
          emitted = true
          queueMicrotask(() => {
            if (body !== undefined) listeners.data?.(Buffer.from(JSON.stringify(body)))
            listeners.end?.()
          })
        }
        return req
      },
    }
    let status = 0
    const chunks: Buffer[] = []
    let ended = false
    const respHeaders: Record<string, string> = {}
    const push = (chunk: unknown) => {
      // Preserve BYTES: a served image write()s Buffers, and String() would
      // UTF-8-mangle them (the same rule as the static-asset byte path).
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8'))
    }
    const finish = () => {
      if (ended) return
      ended = true
      resolvePromise({ status: status || 200, headers: respHeaders, body: Buffer.concat(chunks) })
    }
    const res: any = {
      writeHead(s: number, hdrs?: Record<string, string>) {
        status = s
        if (hdrs) for (const [k, v] of Object.entries(hdrs)) respHeaders[k.toLowerCase()] = String(v)
        return res
      },
      setHeader(name: string, value: string | string[]) {
        respHeaders[String(name).toLowerCase()] = String(value)
      },
      write(chunk: unknown) {
        push(chunk)
        return true
      },
      end(chunk?: unknown) {
        if (chunk) push(chunk)
        finish()
      },
      flushHeaders() {},
      on() {},
      get writableEnded() {
        return ended
      },
    }
    const fail = (s: number, code: string, message: string) => {
      status = s
      chunks.length = 0
      push(JSON.stringify({ error: { code, message } }))
      respHeaders['content-type'] = 'application/json; charset=utf-8'
      finish()
    }
    router.handle(req, res, url).then(
      (handled) => {
        if (!handled) fail(404, 'not_found', `No route ${method} ${url.pathname}`)
        // handled-but-not-ended = a still-open stream; the timeout in the
        // caller bounds it. finish() fires on the eventual end().
      },
      () => fail(500, 'internal', 'Internal error'),
    )
  })
}

/** Parse an SSE body (`data: {...}` frames) into the array of its JSON events —
 *  the send-message reply stream, made request/response-shaped for a tool result. */
function parseSseFrames(body: string): unknown[] {
  const events: unknown[] = []
  for (const line of body.split('\n')) {
    if (!line.startsWith('data:')) continue
    const payload = line.slice(5).trim()
    if (!payload) continue
    try {
      events.push(JSON.parse(payload))
    } catch {
      events.push(payload)
    }
  }
  return events
}

type JsonRpcId = string | number | null

const rpcError = (id: JsonRpcId, code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } })
const rpcResult = (id: JsonRpcId, result: unknown) => ({ jsonrpc: '2.0', id, result })

function sendRpc(res: ServerResponse, payload: unknown, status = 200): void {
  const text = JSON.stringify(payload)
  res.writeHead(status, { ...BASE_HEADERS, 'Content-Type': 'application/json; charset=utf-8' })
  res.end(text)
}

const INSTRUCTIONS = [
  'Every tool is one HTTP operation of this workspace, dispatched through the same route table, auth wall, and tenancy checks as the web UI (access-parity INV-11) — the three access methods (UI, in-app session, MCP) differ in form, never in capability or policy.',
  `To authenticate, call post_auth_login with {"body": {"email": "...", "password": "...", "transport": "bearer"}} — the result's body.token is a session credential; present it on subsequent requests as an "Authorization: Bearer <token>" HTTP header.`,
  'Unauthenticated calls see exactly what a signed-out browser sees (the front door; 401 elsewhere when the auth gate is on).',
  'Tool results are the JSON {status, body} of the underlying HTTP response; the send-message tool returns the reply stream as a parsed event array.',
].join(' ')

/** Register the MCP endpoint on the router. Call LAST in buildRouter so the
 *  route table the tools derive from is complete (derivation is lazy anyway;
 *  this just keeps registration order honest). */
export function registerMcp(router: Router): void {
  const timeoutMs = () => positiveNumberEnv(process.env.MCP_TOOL_TIMEOUT_MS, 120_000)

  router.post('/mcp', async ({ req, res, url, body }) => {
    let msg: any
    try {
      msg = await body<any>()
    } catch {
      return sendRpc(res, rpcError(null, -32700, 'Parse error: request body is not valid JSON'), 400)
    }
    if (Array.isArray(msg)) {
      return sendRpc(res, rpcError(null, -32600, `Batching is not supported (MCP ${MCP_PROTOCOL_VERSION})`), 400)
    }
    if (!msg || msg.jsonrpc !== '2.0') {
      return sendRpc(res, rpcError(null, -32600, 'Invalid request: expected a JSON-RPC 2.0 message'), 400)
    }
    // A notification, or a client's response to a server request (we send
    // none): accepted, nothing to answer.
    if (msg.method === undefined || msg.id === undefined) {
      if (typeof msg.method === 'string' || 'result' in msg || 'error' in msg) {
        res.writeHead(202, BASE_HEADERS)
        res.end()
        return
      }
      return sendRpc(res, rpcError(null, -32600, 'Invalid request'), 400)
    }
    const id: JsonRpcId = msg.id

    if (msg.method === 'initialize') {
      return sendRpc(
        res,
        rpcResult(id, {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'universal-workspace', title: 'Universal Workspace (adaptive-conversation prototype)', version: '1.0.0' },
          instructions: INSTRUCTIONS,
        }),
      )
    }
    if (msg.method === 'ping') return sendRpc(res, rpcResult(id, {}))
    if (msg.method === 'tools/list') {
      return sendRpc(res, rpcResult(id, { tools: toolRoutes(router).map(toolDefinition) }))
    }
    if (msg.method === 'tools/call') {
      const name = msg.params?.name
      const args = msg.params?.arguments ?? {}
      const tool = toolRoutes(router).find((t) => t.name === name)
      if (!tool) return sendRpc(res, rpcError(id, -32602, `Unknown tool: ${String(name)}`))
      for (const p of tool.params) {
        if (typeof args[p] !== 'string' || args[p] === '') {
          return sendRpc(res, rpcError(id, -32602, `Missing required path parameter: ${p}`))
        }
      }
      const path = tool.pattern
        .split('/')
        .filter(Boolean)
        // The `rest` tail keeps its slashes but encodes each segment, so a
        // value carrying `?`/`#`/`..` can't rewrite the inner URL. (No `*`
        // route exists today — this is the defensive posture for the day one does.)
        .map((s) =>
          s === '*'
            ? String(args.rest).split('/').map(encodeURIComponent).join('/')
            : s.startsWith(':')
              ? encodeURIComponent(String(args[s.slice(1)]))
              : s,
        )
        .join('/')
      const inner = new URL(`/${path}`, url.origin)
      if (args.query && typeof args.query === 'object') {
        for (const [k, v] of Object.entries(args.query as Record<string, unknown>)) {
          if (v !== undefined && v !== null) inner.searchParams.set(k, String(v))
        }
      }
      const ms = timeoutMs()
      let timer: ReturnType<typeof setTimeout> | undefined
      const outcome = await Promise.race([
        dispatch(router, tool.method, inner, req.headers, tool.method === 'GET' ? undefined : args.body),
        new Promise<'timeout'>((resolveTimeout) => {
          timer = setTimeout(() => resolveTimeout('timeout'), ms)
          timer.unref?.()
        }),
      ]).finally(() => clearTimeout(timer))
      if (outcome === 'timeout') {
        return sendRpc(
          res,
          rpcResult(id, {
            content: [{ type: 'text', text: `Tool timed out after ${ms}ms; the operation may still complete server-side.` }],
            isError: true,
          }),
        )
      }
      const contentType = outcome.headers['content-type'] ?? ''
      const isError = outcome.status >= 400
      // Served image bytes ride as first-class MCP image content — the same
      // capability the UI has when it renders `/fs/content` into an <img>.
      if (!isError && /^image\//.test(contentType) && outcome.body.length > 0) {
        return sendRpc(
          res,
          rpcResult(id, {
            content: [{ type: 'image', data: outcome.body.toString('base64'), mimeType: contentType.split(';')[0] }],
            isError: false,
          }),
        )
      }
      const text = outcome.body.toString('utf8')
      let parsed: unknown = text
      if (contentType.includes('application/json')) {
        try {
          parsed = text ? JSON.parse(text) : null
        } catch {
          parsed = text
        }
      } else if (contentType.includes('text/event-stream')) {
        parsed = parseSseFrames(text)
      }
      return sendRpc(
        res,
        rpcResult(id, {
          content: [{ type: 'text', text: JSON.stringify({ status: outcome.status, body: parsed }, null, 2) }],
          isError,
        }),
      )
    }
    return sendRpc(res, rpcError(id, -32601, `Method not found: ${String(msg.method)}`))
  })

  // Stateless server: no server-initiated stream to GET, no session to DELETE.
  const methodNotAllowed = (res: ServerResponse, what: string) => {
    res.writeHead(405, { ...BASE_HEADERS, Allow: 'POST', 'Content-Type': 'text/plain; charset=utf-8' })
    res.end(`Method Not Allowed: this MCP server is stateless — ${what}`)
  }
  router.get('/mcp', ({ res }) => methodNotAllowed(res, 'POST JSON-RPC messages to /mcp.'))
  router.delete('/mcp', ({ res }) => methodNotAllowed(res, 'there is no session to terminate.'))
}
