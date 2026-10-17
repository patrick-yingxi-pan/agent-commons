/** ── Usage metering — the composer gauge, made real ─────────────────────────
 *  The gauge reads two genuinely different things, and both are now derived from
 *  real activity rather than a fixture:
 *
 *  • **Context window** (the inner disc) — the *open* conversation's size: a
 *    fixed system+tools baseline plus an estimate of every message in the thread,
 *    against the model's context window. Computed per session in `store.usage`.
 *  • **Plan limits** (the two rings: 5-hour, weekly) — tenant-scoped local rolling
 *    meters that accumulate validated usage counts from every model call
 *    (`store.recordUsage`, fed by endpoint responses or Session relay estimates).
 *    Only the default
 *    demo tenant gets a prior-usage fixture; clean installs and new tenants start
 *    at zero. Consumption and period anchors persist together across restarts.
 *
 *  Context sizes and development-provider counts remain estimates. These local
 *  counters are not a provider billing ledger or a reservation for unreported
 *  in-flight spend. The injected clock makes reset boundaries testable. */
import type { Budget, BudgetWindow, UsageWindow } from '../contract/index.ts'
import { overBudgetWindow } from '../contract/index.ts'
// Re-export the shared metering helpers the store also uses, so its import site
// stays `./usage.ts` (the meter's home) even though the math lives in the contract.
export { CONTEXT_WINDOW, estimateTokens, formatTokens } from '../contract/index.ts'

const HOUR = 3_600_000
const DAY = 24 * HOUR
export const MAX_USAGE_STATE_START = 8_640_000_000_000_000 - 7 * DAY
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** Stable local window identities and lengths, shared with tenant reservation accounting. */
export const USAGE_WINDOW_DEFINITIONS = [
  { key: 'fiveHour', label: '5-hour limit', windowMs: 5 * HOUR },
  { key: 'weekly', label: 'Weekly · all models', windowMs: 7 * DAY },
] as const

interface LimitWindow {
  key: 'fiveHour' | 'weekly'
  label: string
  ceiling: number
  consumed: number
  windowMs: number
  start: number
}

export interface UsageWindowState { start: number; consumed: number }
export interface UsageMeterState { fiveHour: UsageWindowState; weekly: UsageWindowState }

export class UsageStateError extends Error {
  constructor() {
    super('Invalid usage meter state.')
    this.name = 'UsageStateError'
  }
}

const stateWindow = (value: unknown): value is UsageWindowState => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return false
  const keys = Object.keys(value)
  if (keys.length !== 2 || !keys.includes('start') || !keys.includes('consumed')) return false
  const row = value as Record<string, unknown>
  return Number.isSafeInteger(row.start) && (row.start as number) >= 0 && (row.start as number) <= MAX_USAGE_STATE_START && Number.isSafeInteger(row.consumed) && (row.consumed as number) >= 0
}

const validClock = (value: number): boolean => Number.isSafeInteger(value) && value >= 0 && value <= MAX_USAGE_STATE_START

export function parseUsageMeterState(value: unknown): UsageMeterState {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new UsageStateError()
  const keys = Object.keys(value)
  if (keys.length !== 2 || !keys.includes('fiveHour') || !keys.includes('weekly')) throw new UsageStateError()
  const row = value as Record<string, unknown>
  if (!stateWindow(row.fiveHour) || !stateWindow(row.weekly)) throw new UsageStateError()
  return {
    fiveHour: { start: row.fiveHour.start, consumed: row.fiveHour.consumed },
    weekly: { start: row.weekly.start, consumed: row.weekly.consumed },
  }
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
  /** Detached rolling-window state for durable persistence; ceilings are code-owned. */
  snapshot(): UsageMeterState
}

/** Build the plan-usage meter. `now` is injected so tests can drive the reset
 *  boundaries deterministically. `seeded` (default true) starts the windows with a
 *  plausible prior-usage baseline so the gauge reads like a real mid-period account —
 *  right for the default tenant's demo. A *fresh* per-tenant meter (F2/PD9: usage is
 *  metered per tenant, not globally) passes `seeded=false` so a new tenant starts at
 *  zero consumption rather than inheriting the demo baseline. The ceilings are the same
 *  either way — they're the plan, not the spend. */
export function createUsageMeter(now: () => number, seeded = true, persisted?: unknown): UsageMeter {
  const t0 = now()
  if (!validClock(t0)) throw new RangeError('Usage clock is outside the supported date range.')
  // The 5-hour pair is scaled ×2 from its original 852k/1.2M (same 71% gauge):
  // the old seed left ~348k absolute headroom, which the heaviest test file's
  // ~12 turns consumed almost exactly — so ANY growth of the per-turn metered
  // surface (each new route adds a generated API tool to every turn's estimate)
  // tipped real sends into the 429 limit gate. Same demo face, double margin.
  const restored = persisted === undefined ? undefined : parseUsageMeterState(persisted)
  const fiveHour: LimitWindow = { key: 'fiveHour', label: '5-hour limit', ceiling: 2_400_000, consumed: restored?.fiveHour.consumed ?? (seeded ? 1_704_000 : 0), windowMs: 5 * HOUR, start: restored?.fiveHour.start ?? t0 }
  const weekly: LimitWindow = { key: 'weekly', label: 'Weekly · all models', ceiling: 24_000_000, consumed: restored?.weekly.consumed ?? (seeded ? 5_760_000 : 0), windowMs: 7 * DAY, start: restored?.weekly.start ?? t0 }
  const windows = [fiveHour, weekly]

  // Roll a window forward to the current period, zeroing its consumption, if its
  // span has elapsed since it last started.
  const roll = (t: number) => {
    if (!validClock(t)) throw new RangeError('Usage clock is outside the supported date range.')
    for (const w of windows) {
      if (t >= w.start && t - w.start >= w.windowMs) {
        w.start += Math.floor((t - w.start) / w.windowMs) * w.windowMs
        w.consumed = 0
      }
    }
  }
  const pct = (w: LimitWindow) => Math.min(100, Math.round((w.consumed / w.ceiling) * 100))

  return {
    record(inputTokens, outputTokens) {
      if (!Number.isSafeInteger(inputTokens) || inputTokens < 0 || !Number.isSafeInteger(outputTokens) || outputTokens < 0) throw new RangeError('Usage token counts must be nonnegative safe integers.')
      const tokens = inputTokens + outputTokens
      if (!Number.isSafeInteger(tokens)) throw new RangeError('Usage token counts exceed the safe integer range.')
      const t = now()
      if (!validClock(t)) throw new RangeError('Usage clock is outside the supported date range.')
      for (const w of windows) {
        const expired = t >= w.start && t - w.start >= w.windowMs
        const current = expired ? 0 : w.consumed
        if (current > Number.MAX_SAFE_INTEGER - tokens) throw new RangeError('Usage token counts exceed the safe integer range.')
      }
      roll(t)
      for (const w of windows) w.consumed += tokens
    },
    planLimits() {
      roll(now())
      return windows.map((window) => ({
        key: window.key,
        label: window.label,
        reset: formatReset(window),
        usedTokens: window.consumed,
        limitTokens: window.ceiling,
        pct: pct(window),
      }))
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
    snapshot() {
      roll(now())
      return { fiveHour: { start: fiveHour.start, consumed: fiveHour.consumed }, weekly: { start: weekly.start, consumed: weekly.consumed } }
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
