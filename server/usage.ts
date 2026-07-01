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
import type { Budget, BudgetWindow, UsageWindow } from '../contract/index.ts'
import { overBudgetWindow } from '../contract/index.ts'
// Re-export the shared metering helpers the store also uses, so its import site
// stays `./usage.ts` (the meter's home) even though the math lives in the contract.
export { CONTEXT_WINDOW, estimateTokens, formatTokens } from '../contract/index.ts'

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
  /** The live plan-limit windows (5-hour, weekly, …). The store pairs these with
   *  the context breakdown to assemble the gauge snapshot. */
  planLimits(): UsageWindow[]
  /** The plan's per-window token ceilings — the *root* of the D8 budget cascade
   *  (an Agent budget / Commission grant must attenuate these). */
  planCeilings(): BudgetWindow[]
  /** Spend-time enforcement (D8): the first window already **at or over** its effective
   *  ceiling, or `null`. The effective ceiling is the plan window tightened by `budget`
   *  (the resolved Agent's) when it caps that window. Once a window is exhausted the next
   *  turn is refused until it resets — the per-turn gate the mint-time funnel doesn't give.
   *  No *spend* mutation (it may roll an expired window forward, like `planLimits()`), so
   *  it's safe to call before a turn. */
  overLimit(budget?: Budget): { label: string; ceiling: number } | null
}

/** Build the plan-usage meter. `now` is injected so tests can drive the reset
 *  boundaries deterministically. `seeded` (default true) starts the windows with a
 *  plausible prior-usage baseline so the gauge reads like a real mid-period account —
 *  right for the default tenant's demo. A *fresh* per-tenant meter (F2/PD9: usage is
 *  metered per tenant, not globally) passes `seeded=false` so a new tenant starts at
 *  zero consumption rather than inheriting the demo baseline. The ceilings are the same
 *  either way — they're the plan, not the spend. */
export function createUsageMeter(now: () => number, seeded = true): UsageMeter {
  const t0 = now()
  const fiveHour: LimitWindow = { label: '5-hour limit', ceiling: 1_200_000, consumed: seeded ? 852_000 : 0, windowMs: 5 * HOUR, start: t0 }
  const weekly: LimitWindow = { label: 'Weekly · all models', ceiling: 24_000_000, consumed: seeded ? 5_760_000 : 0, windowMs: 7 * DAY, start: t0 }
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
    planLimits() {
      roll(now())
      return [
        { label: fiveHour.label, reset: formatReset(fiveHour), pct: pct(fiveHour) },
        { label: weekly.label, reset: formatReset(weekly), pct: pct(weekly) },
        { label: 'Sonnet only', reset: '', pct: 0 },
      ]
    },
    planCeilings() {
      return [
        { label: fiveHour.label, ceiling: fiveHour.ceiling },
        { label: weekly.label, ceiling: weekly.ceiling },
      ]
    },
    overLimit(budget) {
      roll(now())
      for (const w of windows) {
        const cap = budget?.windows.find((b) => b.label === w.label)?.ceiling
        const ceiling = cap !== undefined ? Math.min(w.ceiling, cap) : w.ceiling
        if (w.consumed >= ceiling) return { label: w.label, ceiling }
      }
      return null
    },
  }
}

/** Raised by the budget creation funnel when a requested grant exceeds its parent —
 *  a 400-class error (the request named an impossible budget). */
export class BudgetError extends Error {
  readonly code: 'budget_exceeded'
  constructor(message: string) {
    super(message)
    this.code = 'budget_exceeded'
    this.name = 'BudgetError'
  }
}

/** The D8 creation funnel (token-quota face): assert a requested budget is a subset
 *  of the parent ceilings, rejecting an over-grant so it is unrepresentable at mint.
 *  Returns the budget unchanged when valid. The subset math is `overBudgetWindow`
 *  (contract) — shared with any future client-side pre-validation. */
export function mintBudget(parent: BudgetWindow[], requested: Budget): Budget {
  const over = overBudgetWindow(parent, requested)
  if (over) {
    throw new BudgetError(`budget for '${over.label}' (${over.ceiling}) exceeds the parent ceiling`)
  }
  return requested
}
