/** ── The API surface as data (access-parity INV-11) ──────────────────────────
 *  One catalog of every HTTP operation, derived from the live route table, and
 *  one runtime binding to dispatch against it. Both non-HTTP doors consume
 *  this: the MCP door (server/mcp.ts) generates its tools from the catalog,
 *  and the in-app session's generated API tools (server/model/apiTools.ts)
 *  execute through `apiDispatch`. Neither derives its own list — a route added
 *  tomorrow reaches every door tomorrow, from here.
 *
 *  The singleton is bound by `buildRouter()` (routes/index.ts) at construction
 *  time; `generate.ts` and the routes reach dispatch through it without
 *  importing the router (which imports them — the binding breaks the cycle). */
import type { IncomingMessage } from 'node:http'
import type { Router } from './http/router.ts'
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
}

const snake = (s: string) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`).replace(/-/g, '_')

/** Deterministic tool name for a route. Uniqueness across the catalog is
 *  locked by `tests/mcp-parity.test.ts`. */
export function toolNameFor(method: string, pattern: string): string {
  const segs = pattern
    .split('/')
    .filter(Boolean)
    .map((s) => (s === '*' ? 'by_rest' : s.startsWith(':') ? `by_${snake(s.slice(1))}` : snake(s)))
  return [method.toLowerCase(), ...segs].join('_')
}

/** Derive the operation catalog from a router. Pure view over `list()`. */
export function catalogOf(router: Router): ApiOperation[] {
  return router.list().map(({ method, pattern }) => ({
    method,
    pattern,
    name: toolNameFor(method, pattern),
    params: pattern
      .split('/')
      .filter(Boolean)
      .map((s) => (s === '*' ? 'rest' : s.startsWith(':') ? s.slice(1) : null))
      .filter((p): p is string => p !== null),
  }))
}

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
  origin = 'http://internal',
): Promise<InnerResponse> {
  if (!bound) throw new Error('apiSurface is not bound — buildRouter() must run first')
  return dispatch(bound, method, new URL(path, origin), headers, body)
}
