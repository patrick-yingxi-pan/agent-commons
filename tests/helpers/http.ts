/** Test helper: drive the *real* route table at the handler level — no port
 *  bound, no entry-point boot, but the real `buildRouter()` + the real store. A
 *  minimal fake req/res captures the status + JSON body so route tests read like
 *  HTTP without the process plumbing. */
import { buildRouter } from '../../server/routes/index.ts'

const router = buildRouter()

export interface CallResult {
  status: number
  json: any
  /** Response headers, lower-cased — captured from writeHead + setHeader. */
  headers: Record<string, string>
}

function makeRes() {
  let status = 0
  let body = ''
  let ended = false
  const headers: Record<string, string> = {}
  const res: any = {
    writeHead(s: number, hdrs?: Record<string, string>) {
      status = s
      if (hdrs) for (const [k, v] of Object.entries(hdrs)) headers[k.toLowerCase()] = String(v)
      return res
    },
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = String(value)
    },
    write(chunk: string) {
      body += chunk
      return true
    },
    end(chunk?: string) {
      if (chunk) body += chunk
      ended = true
    },
    flushHeaders() {},
    on() {},
    get writableEnded() {
      return ended
    },
  }
  return {
    res,
    result(): CallResult {
      return { status, json: body ? JSON.parse(body) : undefined, headers }
    },
  }
}

function makeReq(method: string, bodyObj?: unknown, headers?: Record<string, string>) {
  const handlers: Record<string, (arg?: any) => void> = {}
  let emitted = false
  const req: any = {
    method,
    headers: headers ?? {},
    on(ev: string, cb: (arg?: any) => void) {
      handlers[ev] = cb
      // Emit the body when the handler attaches its `end` listener (readBody adds
      // `data` first, then `end`). Tying emission to listener-registration — rather
      // than a single upfront microtask — keeps it correct no matter how many awaits
      // (e.g. router middleware) run before the handler calls `body()`.
      if (ev === 'end' && !emitted) {
        emitted = true
        queueMicrotask(() => {
          if (bodyObj !== undefined) handlers.data?.(Buffer.from(JSON.stringify(bodyObj)))
          handlers.end?.()
        })
      }
      return req
    },
  }
  return req
}

/** Issue one request against the route table. `path` is under the API root
 *  (the version prefix is already stripped before routing in production). */
export async function call(
  method: string,
  path: string,
  bodyObj?: unknown,
  headers?: Record<string, string>,
): Promise<CallResult> {
  const req = makeReq(method, bodyObj, headers)
  const { res, result } = makeRes()
  await router.handle(req, res, new URL(`http://test${path}`))
  return result()
}

/** Like `call`, but returns the raw response text + status — for the streaming
 *  (SSE) endpoints whose body is `data:` frames, not a single JSON object. The
 *  route runs to completion (so its side-effects, e.g. persisting a turn, land)
 *  before this resolves. */
export async function callRaw(
  method: string,
  path: string,
  bodyObj?: unknown,
): Promise<{ status: number; body: string }> {
  const req = makeReq(method, bodyObj)
  let status = 0
  let body = ''
  let ended = false
  const res: any = {
    writeHead(s: number) {
      status = s
      return res
    },
    setHeader() {},
    write(chunk: string) {
      body += chunk
      return true
    },
    end(chunk?: string) {
      if (chunk) body += chunk
      ended = true
    },
    flushHeaders() {},
    on() {},
    get writableEnded() {
      return ended
    },
  }
  await router.handle(req, res, new URL(`http://test${path}`))
  return { status, body }
}
