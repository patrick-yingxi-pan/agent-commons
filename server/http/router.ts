/** A ~40-line method+path router — the zero-dependency core of the mock server.
 *  Patterns use `:name` segments (`/sessions/:id`); a `*` tail matches the rest
 *  (`/static/*`). Dispatches to the first matching route, with captured params. */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { type Ctx, readBody, sendError } from './respond.ts'

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE'
type Handler = (ctx: Ctx) => void | Promise<void>

interface Route {
  method: Method
  segments: string[]
  handler: Handler
}

export class Router {
  private routes: Route[] = []

  add(method: Method, pattern: string, handler: Handler): this {
    this.routes.push({ method, segments: pattern.split('/').filter(Boolean), handler })
    return this
  }
  get(p: string, h: Handler) {
    return this.add('GET', p, h)
  }
  post(p: string, h: Handler) {
    return this.add('POST', p, h)
  }
  patch(p: string, h: Handler) {
    return this.add('PATCH', p, h)
  }
  delete(p: string, h: Handler) {
    return this.add('DELETE', p, h)
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
        await route.handler(ctx)
      } catch (err) {
        if (!res.writableEnded) {
          sendError(res, 'internal', err instanceof Error ? err.message : 'Unhandled error')
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
      params[seg.slice(1)] = decodeURIComponent(path[i])
    } else if (seg !== path[i]) {
      return null
    }
  }
  return pattern.length === path.length ? params : null
}
