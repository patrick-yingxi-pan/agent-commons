/** Response + request helpers shared by every route. Keeps the routes free of
 *  header/JSON boilerplate and gives one place for the error envelope + CORS. */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ApiError, ApiErrorCode } from '../../contract/index.ts'

/** The per-request context a route handler receives. */
export interface Ctx {
  req: IncomingMessage
  res: ServerResponse
  /** Path params captured from the route pattern (`/sessions/:id` → `{id}`). */
  params: Record<string, string>
  /** Parsed request URL (query via `url.searchParams`). */
  url: URL
  /** Parse the JSON request body (empty body → `{}`). */
  body<T>(): Promise<T>
}

/** Permissive CORS — the dev UI is same-origin via the Vite proxy, but a native
 *  host or a separate dev port may hit the server cross-origin. */
export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

export function sendJson(res: ServerResponse, body: unknown, status = 200): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' })
  res.end(payload)
}

const STATUS_FOR: Record<ApiErrorCode, number> = {
  bad_request: 400,
  not_found: 404,
  forbidden: 403,
  capability_unavailable: 409,
  internal: 500,
}

export function sendError(res: ServerResponse, code: ApiErrorCode, message: string): void {
  const body: ApiError = { error: { code, message } }
  sendJson(res, body, STATUS_FOR[code])
}

/** Max request body — guards against a client exhausting memory. The API only
 *  ever posts small JSON (a message, an op, an id), so 1 MB is generous. */
const MAX_BODY_BYTES = 1024 * 1024

/** Read and JSON-parse the request body. Returns `{}` for an empty body so
 *  handlers can destructure without guarding; rejects past the size cap. */
export function readBody<T>(req: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = []
    let size = 0
    req.on('data', (c) => {
      const chunk = c as Uint8Array
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('request body too large'))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (chunks.length === 0) return resolve({} as T)
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as T)
      } catch (err) {
        reject(err)
      }
    })
    req.on('error', reject)
  })
}
