/** ── The API surface as data (access-parity INV-11) ──────────────────────────
 *  One catalog of every HTTP operation, derived from the live route table, and
 *  one runtime binding to dispatch against it. Both non-HTTP doors consume
 *  this: the MCP door (server/mcp.ts) generates its tools from the catalog,
 *  and the in-app session's generated API tools (server/model/apiTools.ts)
 *  execute through `apiDispatch`. Neither keeps a private list: a product
 *  route reaches every capability surface, while a reasoned form/alias/
 *  intrinsic classification is projected mechanically.
 *
 *  The singleton is bound by `buildRouter()` (routes/index.ts) at construction
 *  time; `generate.ts` and the routes reach dispatch through it without
 *  importing the router (which imports them — the binding breaks the cycle). */
import type { IncomingMessage } from 'node:http'
import type { RouteAccess, Router } from './http/router.ts'
import { dispatch, type InnerResponse } from './http/dispatch.ts'

export interface ApiOperation {
  method: string
  pattern: string
  /** Deterministic tool-name stem: `GET /sessions/:id` → `get_sessions_by_id`.
   *  Doors prefix it for their namespace (MCP uses it bare; the model leg
   *  prefixes `api__`). */
  name: string
  /** The `:param` names in registration order (`*` tail → `rest`). */
  params: string[]
  /** Route-owned access classification. Product operations project into every
   * access method; form-only routes never masquerade as capabilities. */
  access: RouteAccess
  /** Semantic identity used for cross-form parity. Route aliases (list vs
   * by-id projections) may share one capability without pretending their HTTP
   * shapes are identical. Absent for form-only operations. */
  capability?: string
}

const snake = (s: string) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`).replace(/-/g, '_')

/** Deterministic tool name for a route. Uniqueness across the catalog is
 *  locked by `server/mcp-parity.test.ts`. */
export function toolNameFor(method: string, pattern: string): string {
  const segs = pattern
    .split('/')
    .filter(Boolean)
    .map((s) => (s === '*' ? 'by_rest' : s.startsWith(':') ? `by_${snake(s.slice(1))}` : snake(s)))
  return [method.toLowerCase(), ...segs].join('_')
}

/** Derive the operation catalog from a router. Pure view over `list()`. */
export function catalogOf(router: Router): ApiOperation[] {
  return router.list().map(({ method, pattern, access }) => ({
    method,
    pattern,
    name: toolNameFor(method, pattern),
    access,
    ...(access.kind === 'product' ? { capability: access.capability ?? `${method} ${pattern}` } : {}),
    params: pattern
      .split('/')
      .filter(Boolean)
      .map((s) => (s === '*' ? 'rest' : s.startsWith(':') ? s.slice(1) : null))
      .filter((p): p is string => p !== null),
  }))
}

/** Curated request-body EXAMPLES for the common mutations, keyed `"METHOD
 *  /pattern"`. The body types live in `contract/*.ts`, which a runtime tool
 *  schema can't reflect — so the generated tools of BOTH non-HTTP doors surface
 *  these in their input schemas, and a model sees one valid payload instead of
 *  guessing shapes off 400s. Presentation only: the routes remain the
 *  validation authority (an example can never widen capability), and a
 *  malformed body is refused, never guessed at (INV-9). Keys are locked
 *  against the real route table by `server/mcp.test.ts`, and each example must
 *  pass its own route's validation on the SUCCESS path — not merely dodge a
 *  400 behind an earlier 401/404 (the vacuous form that test replaced). */
export const API_BODY_EXAMPLES: ReadonlyMap<string, unknown> = new Map<string, unknown>([
  ['POST /auth/login', { email: 'ada@acme.example', password: '…', transport: 'bearer' }],
  ['POST /auth/token', { label: 'my MCP client' }],
  ['POST /sessions', { firstMessage: 'Draft a launch plan for the insights dashboard' }],
  ['POST /sessions/:id/messages', { text: 'Summarize what changed in this workspace since yesterday.' }],
  ['PATCH /sessions/:id', { title: 'Launch planning', status: 'archived', expectedRevision: 0 }],
  [
    'PATCH /sessions/:id/context-state',
    {
      operations: [
        { action: 'attach', context: { id: 'conn-slack', type: 'connector', label: 'Slack', scope: '*' } },
      ],
      workspace: {
        workspaces: [],
        repos: [],
        connectors: [{ id: 'conn-slack', label: 'Slack', kind: 'connector' }],
        attachments: [],
      },
    },
  ],
  [
    'POST /sessions/:id/local-folders/:folderId/refresh',
    {
      expectedSnapshotId: null,
      requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      snapshot: {
        version: 1,
        snapshotId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        capturedAt: '2026-10-04T12:00:00.000Z',
        connectionId: 'LOCAL_0123456789ABCDEF0123456789ABCDEF',
        files: [],
      },
    },
  ],
  [
    'POST /sessions/:id/workspace/folders/:folderId/local-git-refresh',
    {
      expectedSnapshotId: null,
      requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      snapshot: {
        version: 1,
        snapshotId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        capturedAt: '2026-10-04T12:00:00.000Z',
        connectionId: 'GIT_0123456789ABCDEF0123456789ABCDEF',
        files: [],
      },
    },
  ],
  ['PATCH /saved-contexts/:id', { status: 'connected', expectedRevision: 0 }],
  ['DELETE /saved-contexts/:id', { expectedRevision: 0 }],
  ['PATCH /schedules/:id', { enabled: false, expectedRevision: 0 }],
  ['DELETE /schedules/:id', { expectedRevision: 0 }],
  ['POST /artifacts', { name: 'Launch notes.md', kind: 'doc', body: 'Decisions and next steps from the launch review.' }],
  ['PATCH /artifacts/:id/lifecycle', { state: 'trashed', expectedRevision: 0 }],
  ['PATCH /artifacts/:id/content', { block: 1, text: 'Rewritten paragraph.', expectedRevision: 0 }],
  ['POST /artifacts/:id/history/:revision/restore', { expectedRevision: 1 }],
  [
    'POST /schedules',
    {
      seed: {
        name: 'Daily digest',
        cadence: 'Daily · 9:00 AM',
        next: 'Tomorrow 9:00',
        enabled: true,
        lastStatus: 'pending',
        subtitle: 'A morning summary of workspace activity',
        trigger: 'every day at 9:00 AM',
        timezone: 'UTC',
        missedFirePolicy: 'skip',
        agentId: 'agent-default',
        providerId: 'provider-anthropic',
        modelId: 'claude-opus-4-8',
        effort: 'High',
        prompt: 'Summarize what changed in this workspace since yesterday.',
        steps: [],
        delivery: { tool: { id: 'workspace', label: 'Workspace', tone: 'workspace' }, target: 'Artifacts' },
        runs: [],
        model: 'Claude Opus 4.8 · High',
      },
    },
  ],
  ['POST /notifications/read', { ids: ['n-1'] }],
])

/** Build the concrete inner path for an operation from string args, each path
 *  segment encoded so a value can't rewrite the URL. Throws on a missing param
 *  — callers validate first for a friendlier error. */
export function pathFor(op: ApiOperation, args: Record<string, unknown>): string {
  const path = op.pattern
    .split('/')
    .filter(Boolean)
    .map((s) =>
      s === '*'
        ? String(args.rest).split('/').map(encodeURIComponent).join('/')
        : s.startsWith(':')
          ? encodeURIComponent(String(args[s.slice(1)]))
          : s,
    )
    .join('/')
  return `/${path}`
}

// ── The runtime binding (set once, at buildRouter) ───────────────────────────

let bound: Router | undefined

/** Bind the live router. Called exactly once per router construction. */
export function bindApiSurface(router: Router): void {
  bound = router
}

/** The live operation catalog. Empty before binding (boot order bug — loud). */
export function apiCatalog(): ApiOperation[] {
  if (!bound) throw new Error('apiSurface is not bound — buildRouter() must run first')
  return catalogOf(bound)
}

/** Execute one operation through the bound router — the same wall as HTTP.
 *  `headers` are the ACTING caller's (identity rides them; INV-11). */
export function apiDispatch(
  method: string,
  path: string,
  headers: IncomingMessage['headers'],
  body?: unknown,
  options: { origin?: string; idempotencyKey?: string } = {},
): Promise<InnerResponse> {
  if (!bound) throw new Error('apiSurface is not bound — buildRouter() must run first')
  return dispatch(
    bound,
    method,
    new URL(path, options.origin ?? 'http://internal'),
    headers,
    body,
    { idempotencyKey: options.idempotencyKey },
  )
}
