/** ── Idempotency keys for mutations (design F3 PD15) ─────────────────────────
 *  A retried create (double-click, a network retry after a dropped response) must
 *  not produce a second resource. A client opts in by sending an `Idempotency-Key`
 *  header; the first response for that (tenant, key) is recorded and replayed on any
 *  retry — the handler runs exactly once. Keying includes the tenant (identity F2),
 *  so two tenants' keys can't collide.
 *
 *  Transient by design: this is a short-lived dedup cache (like reservations), TTL'd
 *  and never persisted. Production would back it with the shared store (F6) so it
 *  spans instances; the in-process map is the single-instance form.
 *
 *  Known limitations of this prototype slice (production hardening, not bugs):
 *   • Sequential dedup only — two *truly concurrent* same-key requests can both run
 *     (there's no in-flight reservation marking a key "in progress"). The common case
 *     (a double-click or a retry after the first response landed/timed-out) is
 *     sequential and handled. Production reserves the key in the shared store first.
 *   • The map holds each distinct key until its TTL (default 24h); a client spamming
 *     unique keys grows it unbounded within that window. Production caps/evicts. */
import type { ServerResponse } from 'node:http'
import { CORS_HEADERS } from './http/respond.ts'

/** A recorded HTTP response, enough to replay it verbatim. */
export interface CachedResponse {
  status: number
  body: string
  contentType: string
}

/** A TTL map of (key → recorded response). Entries expire after `ttlMs`; an expired
 *  entry is treated as a miss (the handler re-runs), bounding memory without a sweep. */
export class IdempotencyCache {
  readonly #entries = new Map<string, { rec: CachedResponse; expires: number }>()
  readonly #ttlMs: number

  constructor(ttlMs: number = 24 * 60 * 60 * 1000) {
    this.#ttlMs = ttlMs
  }

  get(key: string): CachedResponse | undefined {
    const e = this.#entries.get(key)
    if (!e) return undefined
    if (e.expires <= Date.now()) {
      this.#entries.delete(key)
      return undefined
    }
    return e.rec
  }

  put(key: string, rec: CachedResponse): void {
    this.#entries.set(key, { rec, expires: Date.now() + this.#ttlMs })
  }

  /** Test/diagnostic: number of live (unexpired-on-read is not enforced here) entries. */
  get size(): number {
    return this.#entries.size
  }
}

/** Wrap a `ServerResponse` so the status/body/content-type it's given are recorded
 *  while still being written to the real socket. `record()` returns what was sent,
 *  or null if the handler produced no response (don't cache a non-response). */
export function captureResponse(real: ServerResponse): {
  res: ServerResponse
  record(): CachedResponse | null
} {
  let status = 0
  let body = ''
  let contentType = 'application/json; charset=utf-8'
  let wrote = false

  const res = {
    writeHead(s: number, headers?: Record<string, string>): ServerResponse {
      status = s
      const ct = headers?.['Content-Type'] ?? headers?.['content-type']
      if (ct) contentType = ct
      wrote = true
      return real.writeHead(s, headers)
    },
    setHeader(name: string, value: string): void {
      real.setHeader(name, value)
    },
    write(chunk: string): boolean {
      body += chunk
      wrote = true
      return real.write(chunk)
    },
    end(chunk?: string): void {
      if (chunk) body += chunk
      wrote = true
      real.end(chunk)
    },
    flushHeaders(): void {
      real.flushHeaders?.()
    },
    on(event: 'close', cb: () => void): void {
      real.on(event, cb)
    },
    get writableEnded(): boolean {
      return real.writableEnded
    },
  } as ServerResponse

  return { res, record: () => (wrote ? { status, body, contentType } : null) }
}

/** Replay a recorded response onto a fresh `ServerResponse` (the retry path). */
export function replayResponse(res: ServerResponse, rec: CachedResponse): void {
  res.writeHead(rec.status, {
    ...CORS_HEADERS,
    'Content-Type': rec.contentType,
    'Idempotency-Replayed': 'true',
  })
  res.end(rec.body)
}
