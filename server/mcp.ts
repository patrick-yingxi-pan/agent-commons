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
import type { ServerResponse } from 'node:http'
import type { Router } from './http/router.ts'
import { BASE_HEADERS } from './http/respond.ts'
import { positiveNumberEnv } from './env.ts'
import { API_BASE_PATH } from '../contract/index.ts'
import { catalogOf, pathFor, toolNameFor, type ApiOperation } from './apiSurface.ts'
import { dispatch } from './http/dispatch.ts'

export { toolNameFor } // re-exported for the parity test (the shared stem lives in apiSurface.ts)

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

/** The tool-exposed routes, derived fresh from the shared catalog each call
 *  (the table is append-only after boot; deriving lazily keeps this a pure view). */
function toolRoutes(router: Router): ApiOperation[] {
  const seen = new Set<string>()
  return catalogOf(router).filter((op) => {
    if (MCP_EXCLUDED.has(`${op.method} ${op.pattern}`)) return false
    if (seen.has(op.name)) throw new Error(`MCP tool name collision: ${op.name} (${op.method} ${op.pattern})`)
    seen.add(op.name)
    return true
  })
}

function toolDefinition(t: ApiOperation) {
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
      // pathFor encodes every segment (the `rest` tail per-segment), so an
      // arg carrying `?`/`#`/`..` can't rewrite the inner URL.
      const inner = new URL(pathFor(tool, args), url.origin)
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
