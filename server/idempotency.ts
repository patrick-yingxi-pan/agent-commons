/** ── Idempotency keys for mutations (design F3 PD15) ─────────────────────────
 *  A retried create must not produce a second resource, and a retried
 *  revision-checked edit must not advance ordering twice. A client opts in by
 *  sending an `Idempotency-Key` header; the first successful response for that
 *  (actor, tenant, key, method + target) is recorded and replayed on any retry — a
 *  completed mutation's handler runs exactly once, while failures remain
 *  retryable. Concurrent copies with the same canonical body share one
 *  in-flight execution rather than both entering the handler; changed
 *  concurrent input or changed operation reuse is a conflict, never a response
 *  from the wrong operation. A completed operation deliberately ignores a
 *  changed retry body: revisioned controllers rebase mutable preconditions while
 *  retaining the logical key, and replay must still win before stale parsing.
 *  Keying includes actor and tenant identity (F2), so neither another account
 *  nor another namespace can receive a caller's retained response.
 *
 *  This middleware is deliberately a short-lived response cache (like
 *  reservations), TTL'd and never persisted. Creation domains that require
 *  restart-safe acknowledgement additionally derive a persisted resource id
 *  from the same key and return that represented truth before changed Retry
 *  input is parsed. Routes without that domain identity retain only this
 *  single-process replay guarantee.
 *
 *  This process-local coordinator is intentionally finite: completed responses
 *  are bounded by count and bytes, oversized responses are shared only with
 *  current waiters, and unique in-flight work has a hard ceiling. A future
 *  multi-host web service replaces this implementation with the same contract in
 *  shared storage; the desktop process needs no distributed lease. */
import type { ServerResponse } from 'node:http'
import { createHash } from 'node:crypto'
import { BASE_HEADERS } from './http/respond.ts'

/** A recorded HTTP response, enough to replay it verbatim. */
export interface CachedResponse {
  status: number
  body: string
  contentType: string
}

export const IDEMPOTENCY_KEY_MAX_LENGTH = 200

const DEFAULT_MAX_ENTRIES = 2_048
const DEFAULT_MAX_BYTES = 16 * 1024 * 1024
const DEFAULT_MAX_IN_FLIGHT = 1_024

export interface IdempotencyCacheLimits {
  maxEntries?: number
  maxBytes?: number
  maxInFlight?: number
}

export class IdempotencyConflictError extends Error {
  constructor() {
    super('This idempotency key is already being used for a different operation or concurrent input.')
    this.name = 'IdempotencyConflictError'
  }
}

export class IdempotencyCapacityError extends Error {
  constructor() {
    super('Too many idempotent requests are already in flight.')
    this.name = 'IdempotencyCapacityError'
  }
}

/** Collision-free process key for one authenticated actor in one namespace. */
export function idempotencyPrincipalKey(
  actorId: string,
  tenantId: string,
  idempotencyKey: string,
): string {
  return JSON.stringify([actorId, tenantId, idempotencyKey])
}

/** JSON bodies are semantically objects, not source-text byte strings: field
 * order cannot turn the same request into a conflict. */
function canonicalJson(value: unknown): string {
  if (value === undefined) return 'undefined'
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined'
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const row = value as Record<string, unknown>
  return `{${Object.keys(row)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(row[key])}`)
    .join(',')}}`
}

/** Opaque, fixed-size identity for the operation a key belongs to. */
export function idempotencyRequestScope(method: string, target: string): string {
  return createHash('sha256')
    .update(`v1\0${method.toUpperCase()}\0${target}`)
    .digest('hex')
}

/** Opaque, fixed-size identity for one in-flight attempt. */
export function idempotencyRequestFingerprint(
  method: string,
  target: string,
  body: unknown,
): string {
  return createHash('sha256')
    .update(`v1\0${idempotencyRequestScope(method, target)}\0${canonicalJson(body)}`)
    .digest('hex')
}

interface CompletedEntry {
  rec: CachedResponse
  scope: string
  expires: number
  bytes: number
}

interface PendingEntry {
  fingerprint: string
  done: Promise<CachedResponse | null>
  settle: (response: CachedResponse | null) => void
}

export interface IdempotencyExecution {
  response: CachedResponse | null
  replayed: boolean
}

const positiveLimit = (value: number | undefined, fallback: number): number => {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return fallback
  return Math.floor(value)
}

const responseBytes = (rec: CachedResponse): number =>
  Buffer.from(rec.body, 'utf8').length + Buffer.from(rec.contentType, 'utf8').length + 16

/** A bounded TTL response cache plus one-owner in-flight coordinator. Entries
 * expire after `ttlMs`; insertion also sweeps expired rows before evicting the
 * oldest completed responses to the configured count/byte budgets. */
export class IdempotencyCache {
  readonly #entries = new Map<string, CompletedEntry>()
  readonly #pending = new Map<string, PendingEntry>()
  readonly #ttlMs: number
  readonly #maxEntries: number
  readonly #maxBytes: number
  readonly #maxInFlight: number
  #bytes = 0

  constructor(
    ttlMs: number = 24 * 60 * 60 * 1000,
    limits: IdempotencyCacheLimits = {},
  ) {
    this.#ttlMs = ttlMs
    this.#maxEntries = positiveLimit(limits.maxEntries, DEFAULT_MAX_ENTRIES)
    this.#maxBytes = positiveLimit(limits.maxBytes, DEFAULT_MAX_BYTES)
    this.#maxInFlight = positiveLimit(limits.maxInFlight, DEFAULT_MAX_IN_FLIGHT)
  }

  get(key: string): CachedResponse | undefined {
    const e = this.#entries.get(key)
    if (!e) return undefined
    if (e.expires <= Date.now()) {
      this.#delete(key, e)
      return undefined
    }
    return e.rec
  }

  put(key: string, rec: CachedResponse, scope: string): void {
    const bytes = responseBytes(rec)
    // A single large response may be handed to current waiters but cannot evict
    // the whole useful cache, replace prior truth, or exceed its byte budget.
    if (bytes > this.#maxBytes) return
    const replaced = this.#entries.get(key)
    if (replaced) this.#delete(key, replaced)
    this.#pruneExpired()
    while (
      this.#entries.size >= this.#maxEntries ||
      this.#bytes + bytes > this.#maxBytes
    ) {
      const oldest = this.#entries.entries().next().value as [string, CompletedEntry] | undefined
      if (!oldest) break
      this.#delete(oldest[0], oldest[1])
    }
    this.#entries.set(key, {
      rec,
      scope,
      expires: Date.now() + this.#ttlMs,
      bytes,
    })
    this.#bytes += bytes
  }

  /** Return completed operation truth before a retry body is read. */
  replay(key: string, scope: string): CachedResponse | undefined {
    const completed = this.#completed(key)
    if (!completed) return undefined
    if (completed.scope !== scope) throw new IdempotencyConflictError()
    return completed.rec
  }

  /** Run one exact attempt as owner, or await/replay the existing owner. Only a
   * successful 2xx graduates into the completed cache; a concurrent waiter may
   * still replay the owner's non-2xx, while any later retry remains free to run. */
  async execute(
    key: string,
    scope: string,
    fingerprint: string,
    operation: () => Promise<CachedResponse | null>,
  ): Promise<IdempotencyExecution> {
    for (;;) {
      const completed = this.#completed(key)
      if (completed) {
        if (completed.scope !== scope) throw new IdempotencyConflictError()
        return { response: completed.rec, replayed: true }
      }

      const pending = this.#pending.get(key)
      if (pending) {
        if (pending.fingerprint !== fingerprint) throw new IdempotencyConflictError()
        const response = await pending.done
        if (response) return { response, replayed: true }
        continue
      }

      if (this.#pending.size >= this.#maxInFlight) throw new IdempotencyCapacityError()
      let settle!: (response: CachedResponse | null) => void
      const done = new Promise<CachedResponse | null>((resolve) => { settle = resolve })
      const owned: PendingEntry = { fingerprint, done, settle }
      this.#pending.set(key, owned)
      let response: CachedResponse | null = null
      try {
        response = await operation()
        if (response && response.status >= 200 && response.status < 300) {
          this.put(key, response, scope)
        }
        return { response, replayed: false }
      } finally {
        if (this.#pending.get(key) === owned) this.#pending.delete(key)
        owned.settle(response)
      }
    }
  }

  #completed(key: string): CompletedEntry | undefined {
    const entry = this.#entries.get(key)
    if (!entry) return undefined
    if (entry.expires <= Date.now()) {
      this.#delete(key, entry)
      return undefined
    }
    return entry
  }

  #delete(key: string, entry: CompletedEntry): void {
    if (!this.#entries.delete(key)) return
    this.#bytes -= entry.bytes
  }

  #pruneExpired(): void {
    const now = Date.now()
    for (const [key, entry] of this.#entries) {
      if (entry.expires <= now) this.#delete(key, entry)
    }
  }

  /** Test/diagnostic counters over bounded process-local state. */
  get size(): number {
    this.#pruneExpired()
    return this.#entries.size
  }

  get bytes(): number {
    this.#pruneExpired()
    return this.#bytes
  }
  get inFlight(): number { return this.#pending.size }
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
    ...BASE_HEADERS,
    'Content-Type': rec.contentType,
    'Idempotency-Replayed': 'true',
  })
  res.end(rec.body)
}
