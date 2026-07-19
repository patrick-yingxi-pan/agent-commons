/** ── The MCP door (access-parity INV-11) ─────────────────────────────────────
 *  Wraps the ENTIRE website as an auth-gated MCP server: `POST /mcp` speaks the
 *  Model Context Protocol (Streamable HTTP transport — JSON-RPC 2.0:
 *  `initialize`, `ping`, `tools/*`, `resources/*`, `prompts/*`), and every tool
 *  is one HTTP operation of this same API.
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
 *  SESSIONS + LIVE PUSH (the stateful half): `initialize` mints an
 *  `Mcp-Session-Id` (POSTs stay accepted without one — leniency over
 *  ceremony); `GET /mcp` with the id opens the standard server→client SSE
 *  stream, which BRIDGES the ambient event log — every `ServerEvent` visible
 *  to the caller's tenant (the SAME `eventVisibleToTenant` gate as
 *  `GET /events`) rides as a `notifications/message` frame, and subscribed
 *  resources get coarse `notifications/resources/updated` hints (events are
 *  invalidation hints in this product's own sync design — the MCP client
 *  re-reads, exactly like the UI's cache). `DELETE /mcp` ends the session.
 *  RESOURCES mirror the parameterless GET routes (`workspace://…` uris;
 *  parameterized reads are resource TEMPLATES), and PROMPTS mirror the
 *  system-prompt library — both read through the router with the caller's
 *  credential, so tenancy holds identically on every MCP primitive.
 *
 *  The few non-tool routes are the ones whose FORM can't be a request/response
 *  tool call (endless SSE streams; the endpoint itself) — enumerated with
 *  reasons in `MCP_EXCLUDED` and locked by `tests/mcp-parity.test.ts` so an
 *  exclusion is a visible, argued decision, never a silent gap. Live streams
 *  are delivered by the GET stream above.
 *
 *  Transport hardening (MCP spec, DNS rebinding): when a deployment pins
 *  `CORS_ORIGIN`, a browser-sent `Origin` that doesn't match is refused (403)
 *  on every `/mcp` method — origin validation, not authorization (non-browser
 *  clients send no Origin and are untouched; the dev default stays open). */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import type { Router } from './http/router.ts'
import { BASE_HEADERS, headerValue } from './http/respond.ts'
import { positiveNumberEnv } from './env.ts'
import { API_BASE_PATH } from '../contract/index.ts'
import { API_BODY_EXAMPLES, catalogOf, pathFor, toolNameFor, type ApiOperation } from './apiSurface.ts'
import { dispatch } from './http/dispatch.ts'
import { store } from './store.ts'

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
  // The instance-operator plane (the maintainer console, contract/admin.ts):
  // cross-tenant administration is the maintainer's own act at the console — an
  // MCP-scripted cross-tenant read/revoke is the confused-deputy shape, the same
  // argument that walls the credential plane. The 404 maintainer wall re-checks
  // regardless; exclusion keeps the tool catalog free of routes almost no
  // caller can ever use.
  ['GET /admin/users', 'the maintainer console — instance administration is the maintainer\'s own act at the console'],
  ['GET /admin/tenants', 'the maintainer console — instance administration is the maintainer\'s own act at the console'],
  ['GET /admin/invites', 'the maintainer console — instance administration is the maintainer\'s own act at the console'],
  ['GET /admin/tokens', 'the maintainer console — instance administration is the maintainer\'s own act at the console'],
  ['GET /admin/audit', 'the maintainer console — instance administration is the maintainer\'s own act at the console'],
  ['GET /admin/ops', 'the maintainer console — instance administration is the maintainer\'s own act at the console'],
  ['POST /admin/users/:id/deactivate', 'the maintainer console — deactivating an account is credential admin, a direct maintainer act'],
  ['DELETE /admin/tokens/:userId/:id', 'the maintainer console — revoking another user\'s credential is a direct maintainer act'],
  ['DELETE /admin/invites/:id', 'the maintainer console — closing another org\'s invitation is a direct maintainer act'],
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
    const example = API_BODY_EXAMPLES.get(`${t.method} ${t.pattern}`)
    properties.body = {
      type: 'object',
      description:
        'JSON request body — shapes follow the HTTP contract (contract/api.ts and siblings); a malformed body is refused, never guessed at (INV-9).',
      // One curated valid payload where we have one (models read `examples`);
      // presentation only — the route stays the validation authority.
      ...(example !== undefined ? { examples: [example] } : {}),
    }
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
    // MCP tool annotations, derived MECHANICALLY from the operation shape (so
    // they can't drift from the route): clients use these to badge read-only
    // vs destructive tools and to gate confirmation UX.
    annotations: {
      title: `${t.method} ${API_BASE_PATH}${t.pattern}`,
      readOnlyHint: t.method === 'GET',
      destructiveHint: t.method === 'DELETE',
      idempotentHint: t.method !== 'POST',
      openWorldHint: false, // every tool acts on THIS workspace, nothing beyond it
    },
  }
}

/** The CORE toolset — a curated PRESENTATION subset for `tools/list` when the
 *  client connects with `?toolset=core` on the endpoint URL: the everyday
 *  conversational spine (auth, sessions + messages, projects/artifacts,
 *  schedules, search/usage/notifications) instead of the full ~140-operation
 *  catalog, so a model's tool context stays small. STRICTLY presentation:
 *  `tools/call` accepts the FULL catalog on either URL (capability and policy
 *  never vary by toolset — INV-11; the wall is auth, not the list). Every name
 *  here must exist in the generated catalog (locked by tests/mcp.test.ts). */
export const MCP_CORE_TOOLS: readonly string[] = [
  'get_capabilities',
  'get_me',
  'post_auth_login',
  'post_auth_token',
  'get_auth_tokens',
  'get_sessions',
  'get_sessions_by_id',
  'post_sessions',
  'patch_sessions_by_id',
  'delete_sessions_by_id',
  'post_sessions_by_id_messages',
  'get_projects',
  'get_artifacts',
  'get_artifact_content',
  'get_saved_contexts',
  'get_schedules',
  'post_schedules',
  'patch_schedules_by_id',
  'delete_schedules_by_id',
  'post_schedules_by_id_run',
  'get_search',
  'get_usage',
  'get_recents',
  'get_notifications',
  'post_notifications_read',
]

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
  `To authenticate, call post_auth_login with {"body": {"email": "...", "password": "...", "transport": "bearer"}} — the result's body.token is a session credential; present it on subsequent requests as an "Authorization: Bearer <token>" HTTP header. The user can also mint a token in the UI (Contexts → "This workspace is an MCP server") and revoke any token there later.`,
  'Unauthenticated calls see exactly what a signed-out browser sees (the front door; 401 elsewhere when the auth gate is on).',
  'Tool results are the JSON {status, body} of the underlying HTTP response; the send-message tool returns the reply stream as a parsed event array.',
  "Connecting with ?toolset=core on the endpoint URL lists only the curated everyday subset (sessions, messages, projects, artifacts, schedules, search, usage) — tools/call still accepts the full catalog either way, so any operation remains callable by name.",
  'Tool annotations mark reads (readOnlyHint) and deletes (destructiveHint) mechanically; where a mutation has a curated body example it rides in the input schema (properties.body.examples) — bodies follow the HTTP contract, and a malformed one is refused, never guessed at.',
  'For live push, keep the Mcp-Session-Id this initialize returned and open GET /mcp with it (SSE): ambient workspace events arrive as notifications/message frames, and subscribed resources signal notifications/resources/updated.',
  'Resources mirror the parameterless reads (workspace://… uris; parameterized reads are resource templates); prompts mirror the system-prompt library — both tenant-scoped by your credential.',
].join(' ')

// ── MCP sessions (the stateful half: subscriptions + the GET stream) ─────────
// Transient by design, like the turn registry: a restart just means the client
// re-initializes (its POSTs never depended on the session anyway). Bounded so
// an initialize loop can't grow the map unboundedly — oldest evicted.
interface McpSession {
  id: string
  subscriptions: Set<string>
  /** Close the session's open GET stream, if any (one per session — a new
   *  stream supersedes, a DELETE closes). */
  closeStream?: () => void
}
const MCP_SESSION_CAP = 512
const MCP_SUBSCRIPTION_CAP = 64
const mcpSessions = new Map<string, McpSession>()

/** Dispatch through the router bounded by the tool timeout — so a resource read
 *  or prompt fetch can never hang the RPC forever (a stream route is refused
 *  before this, but a merely slow route is still bounded). On expiry, a
 *  synthetic 504 body; the underlying dispatch settles on its own eventually. */
function boundedDispatch(
  router: Router,
  method: string,
  url: URL,
  headers: IncomingMessage['headers'],
  body: unknown,
): Promise<{ status: number; headers: Record<string, string>; body: Buffer }> {
  const ms = positiveNumberEnv(process.env.MCP_TOOL_TIMEOUT_MS, 120_000)
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    dispatch(router, method, url, headers, body),
    new Promise<{ status: number; headers: Record<string, string>; body: Buffer }>((resolve) => {
      timer = setTimeout(
        () => resolve({ status: 504, headers: { 'content-type': 'application/json; charset=utf-8' }, body: Buffer.from('{"error":{"code":"timeout","message":"operation timed out"}}') }),
        ms,
      )
      timer.unref?.()
    }),
  ]).finally(() => clearTimeout(timer))
}
const mintMcpSession = (): McpSession => {
  if (mcpSessions.size >= MCP_SESSION_CAP) {
    // Evict the oldest STREAMLESS session first: initialize needs no credential,
    // so a churn of bare inits must exhaust its own kind before it can terminate
    // a live client's stream (the gate already keeps anonymous callers from
    // opening streams at all; this bounds the authenticated-churn case too).
    let victim: string | undefined
    for (const [id, s] of mcpSessions) {
      if (!s.closeStream) {
        victim = id
        break
      }
    }
    victim ??= mcpSessions.keys().next().value
    if (victim) {
      mcpSessions.get(victim)?.closeStream?.()
      mcpSessions.delete(victim)
    }
  }
  const session: McpSession = { id: randomUUID(), subscriptions: new Set() }
  mcpSessions.set(session.id, session)
  return session
}
const mcpSessionOf = (req: IncomingMessage): McpSession | undefined => {
  const sid = headerValue(req.headers, 'mcp-session-id')
  return sid ? mcpSessions.get(sid) : undefined
}

// ── Resources & prompts (mirrors of the read surface, same wall) ─────────────

/** `workspace://sessions` ↔ `GET /sessions`. Parameterless reads are static
 *  resources; parameterized reads are TEMPLATES (`workspace://sessions/{id}`). */
const RESOURCE_SCHEME = 'workspace://'
const resourceReads = (router: Router) => toolRoutes(router).filter((op) => op.method === 'GET')
const resourceUri = (pattern: string) => `${RESOURCE_SCHEME}${pattern.replace(/^\//, '').replace(/:([A-Za-z0-9_]+)/g, '{$1}')}`

/** Whether a concrete path matches one of the readable resource patterns —
 *  the GET routes MINUS `MCP_EXCLUDED` (so the never-ending streams `/events`,
 *  the turn stream, `/relay/poll` are structurally unreachable here, never
 *  dispatched to hang). Segment-align: same length, literals equal, `:params`
 *  match anything. */
function matchResourceRead(router: Router, path: string): boolean {
  const segs = path.split('/').filter(Boolean)
  return resourceReads(router).some((op) => {
    const pat = op.pattern.split('/').filter(Boolean)
    if (pat.length !== segs.length) return false
    return pat.every((p, i) => p.startsWith(':') || p === segs[i])
  })
}

/** Read one resource through the router as the caller. Returns `null` when the
 *  uri isn't under the scheme, or `{ refused: true }` when it names no readable
 *  resource (a stream route, or nothing) — both protocol errors at the call
 *  site, neither ever dispatched (so an excluded stream can't hang the RPC or
 *  leak a subscription — the finding this guard closes). */
async function readResource(router: Router, uri: string, req: IncomingMessage, origin: string) {
  if (typeof uri !== 'string' || !uri.startsWith(RESOURCE_SCHEME)) return null
  // Parse via URL so a query/fragment can't smuggle past the pattern match.
  let path: string
  try {
    path = new URL(`/${uri.slice(RESOURCE_SCHEME.length)}`, origin).pathname
  } catch {
    return null
  }
  if (!matchResourceRead(router, path)) return { refused: true as const }
  const out = await boundedDispatch(router, 'GET', new URL(path, origin), req.headers, undefined)
  const contentType = (out.headers['content-type'] ?? '').split(';')[0]
  const content = /^image\//.test(contentType)
    ? { uri, mimeType: contentType, blob: out.body.toString('base64') }
    : { uri, mimeType: contentType || 'text/plain', text: out.body.toString('utf8') }
  return { status: out.status, content }
}

/** The system-prompt library as MCP prompts — read through the router as the
 *  caller (tenant-scoped like every read on every door). */
async function listPrompts(router: Router, req: IncomingMessage, origin: string) {
  const out = await dispatch(router, 'GET', new URL('/system-prompts', origin), req.headers, undefined)
  if (out.status !== 200) return []
  try {
    const rows = JSON.parse(out.body.toString('utf8')) as Array<{ id: string; label: string; body: string; targetFamily?: string }>
    return rows.map((p) => ({
      name: p.id,
      title: p.label,
      description: `System prompt "${p.label}"${p.targetFamily ? ` (authored for the ${p.targetFamily} family)` : ''}.`,
      row: p,
    }))
  } catch {
    return []
  }
}

/** Register the MCP endpoint on the router. Call LAST in buildRouter so the
 *  route table the tools derive from is complete (derivation is lazy anyway;
 *  this just keeps registration order honest). */
export function registerMcp(router: Router): void {
  const timeoutMs = () => positiveNumberEnv(process.env.MCP_TOOL_TIMEOUT_MS, 120_000)

  // DNS-rebinding hardening (MCP spec): with a pinned CORS_ORIGIN, a browser
  // Origin that doesn't match is refused. Origin validation, not authz — the
  // dev default (`*`) stays open and non-browser clients send no Origin.
  const originRefused = (req: IncomingMessage, res: ServerResponse): boolean => {
    const pinned = process.env.CORS_ORIGIN
    const origin = headerValue(req.headers, 'origin')
    if (!pinned || pinned === '*' || !origin || origin === pinned) return false
    res.writeHead(403, { ...BASE_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' })
    res.end(`Forbidden: Origin ${origin} does not match this deployment's pinned origin.`)
    return true
  }

  // The auth gate for the DIRECT-SERVED MCP surfaces — the GET stream and
  // resources/subscribe, which do NOT re-enter the router (so its 401 wall
  // can't see them). They deal in ambient events, and `eventVisibleToTenant`
  // passes the non-tenant-scoped classes (recents/dispatch/runner…) to ANY
  // principal, the anonymous one included — so without this an unauthenticated
  // stream would leak exactly the "meaningful data before sign-in" the gate
  // exists to prevent. Route-equivalent to the middleware: refuse only when
  // the gate is on AND the caller resolved to the anonymous default (a
  // verified session or the dev seam passes, same as every data route). */
  const gateRefusesStream = (req: IncomingMessage): boolean =>
    store.capabilities().features.authGate && store.identity(req.headers).via === 'default'

  router.post('/mcp', async ({ req, res, url, body }) => {
    if (originRefused(req, res)) return
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
      // Mint the session that carries subscriptions + the GET stream. POSTs
      // stay accepted without the id — leniency over ceremony; the id is only
      // REQUIRED where state genuinely lives (subscribe, the stream, DELETE).
      const session = mintMcpSession()
      res.setHeader('Mcp-Session-Id', session.id)
      return sendRpc(
        res,
        rpcResult(id, {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {
            tools: { listChanged: false },
            resources: { subscribe: true, listChanged: false },
            prompts: { listChanged: false },
            logging: {},
          },
          serverInfo: { name: 'universal-workspace', title: 'Universal Workspace (adaptive-conversation prototype)', version: '1.0.0' },
          instructions: INSTRUCTIONS,
        }),
      )
    }
    if (msg.method === 'ping') return sendRpc(res, rpcResult(id, {}))
    if (msg.method === 'tools/list') {
      // `?toolset=core` on the endpoint URL narrows the LIST to the curated
      // everyday subset (a client-chosen presentation; see MCP_CORE_TOOLS).
      // tools/call below never consults it — capability is identical.
      const core = url.searchParams.get('toolset') === 'core'
      const routes = core ? toolRoutes(router).filter((t) => MCP_CORE_TOOLS.includes(t.name)) : toolRoutes(router)
      return sendRpc(res, rpcResult(id, { tools: routes.map(toolDefinition) }))
    }
    if (msg.method === 'resources/list') {
      const resources = resourceReads(router)
        .filter((op) => op.params.length === 0)
        .map((op) => ({ uri: resourceUri(op.pattern), name: op.pattern, mimeType: 'application/json' }))
      return sendRpc(res, rpcResult(id, { resources }))
    }
    if (msg.method === 'resources/templates/list') {
      const resourceTemplates = resourceReads(router)
        .filter((op) => op.params.length > 0)
        .map((op) => ({ uriTemplate: resourceUri(op.pattern), name: op.pattern, mimeType: 'application/json' }))
      return sendRpc(res, rpcResult(id, { resourceTemplates }))
    }
    if (msg.method === 'resources/read') {
      const read = await readResource(router, msg.params?.uri, req, url.origin)
      if (!read) return sendRpc(res, rpcError(id, -32602, `Unknown resource uri (expected ${RESOURCE_SCHEME}…): ${String(msg.params?.uri)}`))
      if ('refused' in read) return sendRpc(res, rpcError(id, -32602, `No readable resource at ${String(msg.params?.uri)} (streams and unknown paths are not resources).`))
      if (read.status >= 400) return sendRpc(res, rpcError(id, -32002, `Resource read refused (${read.status}): ${msg.params.uri}`))
      return sendRpc(res, rpcResult(id, { contents: [read.content] }))
    }
    if (msg.method === 'resources/subscribe' || msg.method === 'resources/unsubscribe') {
      // A subscription is a standing read authorization for the stream — gate
      // it exactly as the stream itself (anonymous must not arm a leak).
      if (msg.method === 'resources/subscribe' && gateRefusesStream(req)) {
        return sendRpc(res, rpcError(id, -32001, 'Sign in to subscribe (AUTH_GATE is on).'))
      }
      const session = mcpSessionOf(req)
      if (!session) {
        return sendRpc(res, rpcError(id, -32600, 'Subscriptions need a session — initialize first and send Mcp-Session-Id.'))
      }
      const uri = msg.params?.uri
      if (typeof uri !== 'string' || !uri.startsWith(RESOURCE_SCHEME)) {
        return sendRpc(res, rpcError(id, -32602, `Unknown resource uri: ${String(uri)}`))
      }
      // Bounded (like the session map): a client can't grow its own fan-out
      // amplification (one updated-frame per subscription per event) without limit.
      if (msg.method === 'resources/subscribe') {
        if (session.subscriptions.size >= MCP_SUBSCRIPTION_CAP && !session.subscriptions.has(uri)) {
          return sendRpc(res, rpcError(id, -32001, `Too many subscriptions (max ${MCP_SUBSCRIPTION_CAP}).`))
        }
        session.subscriptions.add(uri)
      } else session.subscriptions.delete(uri)
      return sendRpc(res, rpcResult(id, {}))
    }
    if (msg.method === 'prompts/list') {
      const prompts = await listPrompts(router, req, url.origin)
      return sendRpc(res, rpcResult(id, { prompts: prompts.map(({ name, title, description }) => ({ name, title, description })) }))
    }
    if (msg.method === 'prompts/get') {
      const prompts = await listPrompts(router, req, url.origin)
      const prompt = prompts.find((p) => p.name === msg.params?.name)
      if (!prompt) return sendRpc(res, rpcError(id, -32602, `Unknown prompt: ${String(msg.params?.name)}`))
      return sendRpc(
        res,
        rpcResult(id, {
          description: prompt.description,
          messages: [{ role: 'user', content: { type: 'text', text: prompt.row.body } }],
        }),
      )
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

  const plain = (res: ServerResponse, status: number, text: string) => {
    res.writeHead(status, { ...BASE_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' })
    res.end(text)
  }

  // ── The server→client stream (live push over MCP) ───────────────────────────
  // Bridges the ambient event log: every ServerEvent visible to THIS request's
  // tenant (the SAME gate as GET /events) rides as a notifications/message
  // frame; subscribed resources additionally signal notifications/resources/
  // updated — COARSE on purpose: in this product events are invalidation
  // hints, and re-reading is the sync model on every door (UI cache included).
  router.get('/mcp', ({ req, res }) => {
    if (originRefused(req, res)) return
    if (gateRefusesStream(req)) return plain(res, 401, 'Sign in to open the event stream (AUTH_GATE is on).')
    const sid = headerValue(req.headers, 'mcp-session-id')
    if (!sid) return plain(res, 400, 'The stream needs a session: initialize first and send Mcp-Session-Id.')
    const session = mcpSessions.get(sid)
    if (!session) return plain(res, 404, 'Unknown or expired Mcp-Session-Id — initialize again.')
    session.closeStream?.() // one stream per session; a new one supersedes
    const tenantId = store.identity(req.headers).tenant.id
    res.writeHead(200, {
      ...BASE_HEADERS,
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    res.flushHeaders?.()
    let open = true
    const frame = (payload: unknown) => {
      if (!open || res.writableEnded) return
      res.write(`data: ${JSON.stringify(payload)}\n\n`)
    }
    const unsubscribe = store.subscribe((e) => {
      if (!store.eventVisibleToTenant(e, tenantId)) return
      frame({ jsonrpc: '2.0', method: 'notifications/message', params: { level: 'info', logger: 'workspace.events', data: e } })
      for (const uri of session.subscriptions) {
        frame({ jsonrpc: '2.0', method: 'notifications/resources/updated', params: { uri } })
      }
    })
    const close = () => {
      if (!open) return
      open = false
      unsubscribe()
      if (!res.writableEnded) res.end()
      // A closed stream must read as STREAMLESS again (the eviction preference
      // keys on `closeStream`) — but only if a superseding stream hasn't
      // already replaced this closure with its own.
      if (session.closeStream === close) session.closeStream = undefined
    }
    session.closeStream = close
    req.on('close', close)
  })

  // End a session: subscriptions drop, its stream closes. Idempotent-ish: an
  // unknown id is an honest 404 (initialize again), absence a 400.
  router.delete('/mcp', ({ req, res }) => {
    if (originRefused(req, res)) return
    const sid = headerValue(req.headers, 'mcp-session-id')
    if (!sid) return plain(res, 400, 'Send the Mcp-Session-Id of the session to terminate.')
    const session = mcpSessions.get(sid)
    if (!session) return plain(res, 404, 'Unknown or expired Mcp-Session-Id.')
    session.closeStream?.()
    mcpSessions.delete(sid)
    res.writeHead(204, BASE_HEADERS)
    res.end()
  })
}
