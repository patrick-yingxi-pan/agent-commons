/** ── Usage metering — the composer gauge, made real ─────────────────────────
 *  The gauge reads two genuinely different things, and both are now derived from
 *  real activity rather than a fixture:
 *
 *  • **Context window** (the inner disc) — the *open* conversation's size: a
 *    fixed system+tools baseline plus an estimate of every message in the thread,
 *    against the model's context window. Computed per session in `store.usage`.
 *  • **Plan limits** (the two rings: 5-hour, weekly) — rolling meters that
 *    accumulate the model's *reported* token usage (input+output) from every turn
 *    (`store.recordUsage`, fed by the real Messages response). Seeded with a
 *    plausible prior-usage baseline so the gauge reads like a real account
 *    mid-period, then grows as you actually use it; each window resets on its
 *    cadence.
 *
 *  Token counts are an estimate (≈ 4 chars/token — the standard rough rule); a
 *  real backend would meter exactly. The clock is injected so the windows' reset
 *  logic is unit-testable. */
import type { UsageSnapshot } from '../contract/index.ts'
import { contextUsage } from '../contract/index.ts'
// Re-export the shared metering helpers the store also uses, so its import site
// stays `./usage.ts` (the meter's home) even though the math lives in the contract.
export { CONTEXT_WINDOW, SYSTEM_BASELINE, estimateTokens, formatTokens } from '../contract/index.ts'

const HOUR = 3_600_000
const DAY = 24 * HOUR
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

interface LimitWindow {
  label: string
  ceiling: number
  consumed: number
  windowMs: number
  start: number
}

/** When a window next resets — a time-of-day for the 5-hour bucket, a date for
 *  the weekly cap (matching how the real app phrases each). */
function formatReset(w: LimitWindow): string {
  const at = new Date(w.start + w.windowMs)
  if (w.windowMs < DAY) {
    const h = at.getHours()
    const hh = ((h + 11) % 12) + 1
    return `Resets ${hh}:${String(at.getMinutes()).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
  }
  return `Resets ${MONTHS[at.getMonth()]} ${at.getDate()}`
}

export interface UsageMeter {
  /** Record one turn's real token usage against every rolling window. */
  record(inputTokens: number, outputTokens: number): void
  /** The gauge snapshot: the given context fill + the live plan windows. */
  snapshot(contextTokens: number): UsageSnapshot
}

/** Build the plan-usage meter. `now` is injected so tests can drive the reset
 *  boundaries deterministically. */
export function createUsageMeter(now: () => number): UsageMeter {
  const t0 = now()
  // Seed: prior usage already consumed this period, so the gauge reads like a
  // real account rather than an empty one — then real turns accumulate on top.
  const fiveHour: LimitWindow = { label: '5-hour limit', ceiling: 1_200_000, consumed: 852_000, windowMs: 5 * HOUR, start: t0 }
  const weekly: LimitWindow = { label: 'Weekly · all models', ceiling: 24_000_000, consumed: 5_760_000, windowMs: 7 * DAY, start: t0 }
  const windows = [fiveHour, weekly]

  // Roll a window forward to the current period, zeroing its consumption, if its
  // span has elapsed since it last started.
  const roll = (t: number) => {
    for (const w of windows) {
      while (t - w.start >= w.windowMs) {
        w.start += w.windowMs
        w.consumed = 0
      }
    }
  }
  const pct = (w: LimitWindow) => Math.min(100, Math.round((w.consumed / w.ceiling) * 100))

  return {
    record(inputTokens, outputTokens) {
      const tokens = Math.max(0, inputTokens) + Math.max(0, outputTokens)
      roll(now())
      for (const w of windows) w.consumed += tokens
    },
    snapshot(contextTokens) {
      roll(now())
      return {
        context: contextUsage(contextTokens),
        limits: [
          { label: fiveHour.label, reset: formatReset(fiveHour), pct: pct(fiveHour) },
          { label: weekly.label, reset: formatReset(weekly), pct: pct(weekly) },
          { label: 'Sonnet only', reset: '', pct: 0 },
        ],
      }
    },
  }
}
