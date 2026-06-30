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

/** Stream raw bytes with a content type — for served image/binary content (a
 *  `GET /fs/content` response, used directly as an `<img src>`). Mirrors the
 *  static-asset byte path in server/index.ts: write the Buffer verbatim so binary
 *  isn't corrupted by a UTF-8 round-trip. */
export function sendBytes(res: ServerResponse, bytes: Uint8Array, contentType: string): void {
  res.writeHead(200, { ...CORS_HEADERS, 'Content-Type': contentType })
  // `end` accepts a string in the ambient types; the Buffer's bytes are written
  // verbatim at runtime (same as the static-asset path). Cast through unknown.
  res.end(bytes as unknown as string)
}

const STATUS_FOR: Record<ApiErrorCode, number> = {
  bad_request: 400,
  not_found: 404,
  forbidden: 403,
  conflict: 409,
  capability_unavailable: 409,
  limit_exceeded: 429,
  internal: 500,
}

export function sendError(res: ServerResponse, code: ApiErrorCode, message: string): void {
  const body: ApiError = { error: { code, message } }
  sendJson(res, body, STATUS_FOR[code])
}

/** Read a single request header value. Node lower-cases incoming header names and
 *  may deliver a repeated header as an array; this normalizes both to one string
 *  (or undefined). Shared by the idempotency + identity seams. */
export function headerValue(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const v = headers[name.toLowerCase()]
  return Array.isArray(v) ? v[0] : v
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
