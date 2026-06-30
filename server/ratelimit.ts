/** ── Per-tenant rate limiting (design F3) ────────────────────────────────────
 *  A fixed-window counter, keyed by tenant (identity F2), bounding how many
 *  mutating requests a tenant can make per window. Production protection against a
 *  noisy/abusive tenant (F3 §"per-tenant rate limits bound noisy neighbors"); the
 *  desktop single-tenant case effectively never trips it.
 *
 *  The limiter is a pure counting structure — the caller passes the limit per check
 *  (the router reads it from config), and an injectable clock makes it deterministic
 *  to test. Opt-in at the router: with no configured limit, the check is skipped. */
export interface RateLimitResult {
  allowed: boolean
  /** Remaining requests in the current window (0 when blocked). */
  remaining: number
  /** Milliseconds until the window resets — the `Retry-After` basis when blocked. */
  retryAfterMs: number
}

export class RateLimiter {
  readonly #windows = new Map<string, { count: number; resetAt: number }>()
  readonly #windowMs: number
  readonly #now: () => number
  readonly #maxKeys: number

  /** `maxKeys` hard-bounds how many distinct windows are tracked (memory guard);
   *  default is generous for real tenants. Injectable, like the clock, for tests. */
  constructor(windowMs: number = 60_000, now: () => number = () => Date.now(), maxKeys: number = 50_000) {
    this.#windowMs = windowMs
    this.#now = now
    this.#maxKeys = maxKeys
  }

  /** Account one request against `key` under `limit`. A window starts on the first
   *  request and lasts `windowMs`; once `count` reaches `limit`, further requests in
   *  the window are blocked (and do NOT extend it). */
  check(key: string, limit: number): RateLimitResult {
    const t = this.#now()
    let w = this.#windows.get(key)
    if (!w || w.resetAt <= t) {
      w = { count: 0, resetAt: t + this.#windowMs }
      this.#windows.set(key, w)
      if (this.#windows.size > this.#maxKeys) this.#evict(t) // bound memory on a new key
    }
    if (w.count >= limit) {
      return { allowed: false, remaining: 0, retryAfterMs: w.resetAt - t }
    }
    w.count++
    return { allowed: true, remaining: limit - w.count, retryAfterMs: 0 }
  }

  /** Keep the window map bounded. First sweep expired windows; if still over the cap
   *  (a burst of distinct live keys — e.g. an attacker cycling `x-tenant-id` on the
   *  remote backend), drop the oldest-inserted. Dropping a live window is harmless —
   *  it just resets that key's count, and a unique-key flood never accrues a count
   *  anyway. Without this, the abuse control would itself be an unbounded-memory sink. */
  #evict(now: number): void {
    for (const [k, w] of this.#windows) {
      if (this.#windows.size <= this.#maxKeys) return
      if (w.resetAt <= now) this.#windows.delete(k)
    }
    while (this.#windows.size > this.#maxKeys) {
      const oldest = this.#windows.keys().next().value
      if (oldest === undefined) return
      this.#windows.delete(oldest)
    }
  }
}
