/** ── Internal dispatch — re-enter the router without a socket (INV-11) ───────
 *  The one synthetic req/res pair every non-HTTP access door uses to execute an
 *  operation through the REAL route table: the MCP door's tools/call
 *  (server/mcp.ts) and the in-app session's generated API tools
 *  (server/model/apiTools.ts, executed via server/apiSurface.ts). The full
 *  middleware chain runs for the inner path — auth gate, identity resolution,
 *  tenancy walls, idempotency, rate limits — which is exactly the point: parity
 *  is a property of the funnel, not of each door's diligence. (Same technique
 *  as tests/helpers/http.ts, which drives the same table the same way.) */
import type { IncomingMessage } from 'node:http'
import type { Router } from './router.ts'

/** Headers NOT forwarded into the inner dispatch: transport plumbing of the
 *  outer request. Credentials (authorization, cookie) and the dev identity
 *  seam ARE forwarded — the inner wall sees exactly what the caller presented. */
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
  // The outer request's idempotency key names THAT operation, not the inner
  // one — forwarding it would let an inner op replay an unrelated cached 2xx
  // (the idem cache keys on (tenant, key) only).
  'idempotency-key',
])

export interface InnerResponse {
  status: number
  headers: Record<string, string>
  /** Raw response bytes — text routes decode as UTF-8; binary routes (served
   *  image content) stay bytes so they can ride onward as base64. */
  body: Buffer
}

/** Re-enter the router with a synthetic request/response pair. Resolves when
 *  the inner response ends; a still-open stream is bounded by the CALLER's
 *  timeout, never here. */
export function dispatch(
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
        // handled-but-not-ended = a still-open stream; the caller's timeout
        // bounds it. finish() fires on the eventual end().
      },
      () => fail(500, 'internal', 'Internal error'),
    )
  })
}
