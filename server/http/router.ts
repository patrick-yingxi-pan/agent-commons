/** A ~40-line method+path router — the zero-dependency core of the mock server.
 *  Patterns use `:name` segments (`/sessions/:id`); a `*` tail matches the rest
 *  (`/static/*`). Dispatches to the first matching route, with captured params. */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { type Ctx, readBody, sendError } from './respond.ts'
import { PersistenceWriteError } from '../persistence/persist.ts'

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE'
type Handler = (ctx: Ctx) => void | Promise<void>
/** Cross-cutting pre-handler step. Runs after a route matches, before its handler;
 *  return false to short-circuit (the middleware has already written the response —
 *  e.g. a 429 from rate limiting). */
type Middleware = (ctx: Ctx) => boolean | Promise<boolean>

/** How one route participates in access parity (INV-11).
 *
 * Product operations are projected into every access surface by default. A
 * route may instead be protocol/ceremony FORM (health probes, authentication
 * entry, streams, machine callbacks), which is not a workspace capability and
 * must carry the reason at its declaration. Multiple route shapes may realize
 * one semantic capability (`capability`), and the in-app session may realize a
 * capability intrinsically rather than by giving the model a recursive or
 * self-consenting tool (`session: 'intrinsic'`). */
export type RouteAccess =
  | {
      kind: 'product'
      capability?: string
      session?: 'tool' | 'intrinsic'
      reason?: string
    }
  | {
      kind: 'form'
      reason: string
      /** Some protocol/credential/presentation forms are deliberately presented by the UI
       * (sign-in, account switching, stream replay, viewer chrome). Declaring that fact makes
       * a product route accidentally reclassified as form fail the UI lock. */
      ui?: 'form'
      /** Authentication bootstrap may be callable over remote MCP without
       * becoming an authenticated workspace capability. */
      remote?: 'tool'
    }

const PRODUCT_ACCESS: RouteAccess = { kind: 'product', session: 'tool' }

export const formOnly = (reason: string): RouteAccess => ({ kind: 'form', reason })
export const uiForm = (reason: string): RouteAccess => ({ kind: 'form', reason, ui: 'form' })
export const uiRemoteMcpForm = (reason: string): RouteAccess => ({ kind: 'form', reason, ui: 'form', remote: 'tool' })
export const capabilityAlias = (capability: string, reason: string): RouteAccess => ({
  kind: 'product',
  capability,
  session: 'tool',
  reason,
})
export const sessionIntrinsic = (reason: string, capability?: string): RouteAccess => ({
  kind: 'product',
  ...(capability ? { capability } : {}),
  session: 'intrinsic',
  reason,
})

interface Route {
  method: Method
  /** The registration pattern, verbatim (`/sessions/:id`). Kept alongside the
   *  split segments so the route table is enumerable as data — the MCP access
   *  method (server/mcp.ts) generates its tool catalog from `list()`, which is
   *  what makes "every route is reachable through every access method" hold by
   *  construction instead of by a hand-maintained list. */
  pattern: string
  access: RouteAccess
  segments: string[]
  handler: Handler
}

/** One route's public identity — what `Router.list()` exposes. */
export interface RouteInfo {
  method: Method
  pattern: string
  access: RouteAccess
}

export class Router {
  private routes: Route[] = []
  private middlewares: Middleware[] = []

  /** Register a middleware run (in order) before any matched handler. */
  use(mw: Middleware): this {
    this.middlewares.push(mw)
    return this
  }

  /** The registered routes, as data. Read-only: consumers derive from the
   *  table (tool catalogs, parity tests); registration stays `add()` only. */
  list(): RouteInfo[] {
    return this.routes.map(({ method, pattern, access }) => ({ method, pattern, access }))
  }

  add(method: Method, pattern: string, handler: Handler, access: RouteAccess = PRODUCT_ACCESS): this {
    this.routes.push({ method, pattern, access, segments: pattern.split('/').filter(Boolean), handler })
    return this
  }
  get(p: string, h: Handler, access?: RouteAccess) {
    return this.add('GET', p, h, access)
  }
  post(p: string, h: Handler, access?: RouteAccess) {
    return this.add('POST', p, h, access)
  }
  patch(p: string, h: Handler, access?: RouteAccess) {
    return this.add('PATCH', p, h, access)
  }
  delete(p: string, h: Handler, access?: RouteAccess) {
    return this.add('DELETE', p, h, access)
  }

  /** Route-declaration shorthands keep non-default access semantics beside the
   * path itself; reviewers never have to reconcile a second exclusion list. */
  formGet(p: string, reason: string, h: Handler) {
    return this.get(p, h, formOnly(reason))
  }
  uiFormGet(p: string, reason: string, h: Handler) {
    return this.get(p, h, uiForm(reason))
  }
  formPost(p: string, reason: string, h: Handler) {
    return this.post(p, h, formOnly(reason))
  }
  uiFormPost(p: string, reason: string, h: Handler) {
    return this.post(p, h, uiForm(reason))
  }
  uiRemoteMcpFormPost(p: string, reason: string, h: Handler) {
    return this.post(p, h, uiRemoteMcpForm(reason))
  }
  formPatch(p: string, reason: string, h: Handler) {
    return this.patch(p, h, formOnly(reason))
  }
  uiFormPatch(p: string, reason: string, h: Handler) {
    return this.patch(p, h, uiForm(reason))
  }
  formDelete(p: string, reason: string, h: Handler) {
    return this.delete(p, h, formOnly(reason))
  }
  uiFormDelete(p: string, reason: string, h: Handler) {
    return this.delete(p, h, uiForm(reason))
  }
  aliasGet(p: string, capability: string, reason: string, h: Handler) {
    return this.get(p, h, capabilityAlias(capability, reason))
  }
  intrinsicPost(p: string, reason: string, h: Handler, capability?: string) {
    return this.post(p, h, sessionIntrinsic(reason, capability))
  }

  /** Try to match + run a route. Returns false if nothing matched (the caller
   *  then falls through to static-file serving / 404). */
  async handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    const path = url.pathname.split('/').filter(Boolean)
    for (const route of this.routes) {
      if (route.method !== req.method) continue
      const params = match(route.segments, path)
      if (!params) continue
      const ctx: Ctx = { req, res, params, url, body: () => readBody(req) }
      try {
        for (const mw of this.middlewares) {
          if (!(await mw(ctx))) return true // middleware handled the response (e.g. 429)
        }
        await route.handler(ctx)
      } catch (err) {
        // Log the detail server-side; don't leak internals to the client.
        console.error('[mock-backend] route error:', err)
        if (!res.writableEnded) {
          if (err instanceof PersistenceWriteError) {
            sendError(res, 'storage_unavailable', 'Durable storage is unavailable. Restart the app after checking disk access.')
          } else {
            sendError(res, 'internal', 'Internal error')
          }
        }
      }
      return true
    }
    return false
  }
}

/** Match a pattern's segments against a request path. Returns captured params,
 *  or null if no match. A trailing `*` segment captures the remainder as `rest`. */
function match(pattern: string[], path: string[]): Record<string, string> | null {
  const params: Record<string, string> = {}
  for (let i = 0; i < pattern.length; i++) {
    const seg = pattern[i]
    if (seg === '*') {
      params.rest = path.slice(i).join('/')
      return params
    }
    if (i >= path.length) return null
    if (seg.startsWith(':')) {
      // A malformed percent-sequence (e.g. `/owners/%`) makes decodeURIComponent
      // throw, and match() runs BEFORE the per-route try/catch — an uncaught throw
      // here would reject handle() and hang the request. Treat it as a non-match
      // (the caller falls through to 404): a path that doesn't decode names nothing.
      try {
        params[seg.slice(1)] = decodeURIComponent(path[i])
      } catch {
        return null
      }
    } else if (seg !== path[i]) {
      return null
    }
  }
  return pattern.length === path.length ? params : null
}
