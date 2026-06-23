/** Test helper: drive the *real* route table at the handler level — no port
 *  bound, no entry-point boot, but the real `buildRouter()` + the real store. A
 *  minimal fake req/res captures the status + JSON body so route tests read like
 *  HTTP without the process plumbing. */
import { buildRouter } from '../../server/routes/index.ts'

const router = buildRouter()

export interface CallResult {
  status: number
  json: any
}

function makeRes() {
  let status = 0
  let body = ''
  let ended = false
  const res: any = {
    writeHead(s: number, _headers?: Record<string, string>) {
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
  return {
    res,
    result(): CallResult {
      return { status, json: body ? JSON.parse(body) : undefined }
    },
  }
}

function makeReq(method: string, bodyObj?: unknown) {
  const handlers: Record<string, (arg?: any) => void> = {}
  const req: any = {
    method,
    on(ev: string, cb: (arg?: any) => void) {
      handlers[ev] = cb
      return req
    },
  }
  // Emit the body once the route handler has attached its readBody listeners
  // (which happens synchronously before the first await suspends the chain).
  queueMicrotask(() => {
    if (bodyObj !== undefined) handlers.data?.(Buffer.from(JSON.stringify(bodyObj)))
    handlers.end?.()
  })
  return req
}

/** Issue one request against the route table. `path` is under the API root
 *  (the version prefix is already stripped before routing in production). */
export async function call(method: string, path: string, bodyObj?: unknown): Promise<CallResult> {
  const req = makeReq(method, bodyObj)
  const { res, result } = makeRes()
  await router.handle(req, res, new URL(`http://test${path}`))
  return result()
}
