/** ── Numeric env-var parsing (shared, pure, testable) ────────────────────────
 *  Validate-and-floor helpers so an empty (`Number('')===0`) or garbage (`NaN`) env
 *  var can't collapse a tunable to a degenerate value (which would, e.g., abort every
 *  model call instantly or reap every runner each tick). One source of truth for the
 *  idiom that was being hand-rolled at each call site, locked by tests/env.test.ts. */

/** A finite, strictly-positive number, else the fallback. For durations/timeouts. An
 *  unset or empty/whitespace var means "not configured" → fallback. */
export function positiveNumberEnv(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

/** A non-negative integer, else the fallback. For counts where 0 is a legitimate value
 *  (e.g. "no retries"); an unset or empty/whitespace var is treated as "not configured"
 *  → fallback (so a blank var doesn't silently mean 0). */
export function nonNegativeIntEnv(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback
  const n = Number(raw)
  return Number.isInteger(n) && n >= 0 ? n : fallback
}
