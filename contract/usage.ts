/** ── Contract: usage metering ───────────────────────────────────────────────
 *  What the composer's usage gauge (and its popup) read. One snapshot covers the
 *  active conversation's context window plus the plan's rolling limit windows
 *  (5-hour, weekly, …), each expressed as a percent of its own ceiling.
 *
 *  Server-owned: in the real product these come from the account's live metering
 *  (and the context figure from the open session); here they're a seeded fixture
 *  served over the API, so the UI's copy is a cache, not a source of truth. */

/** The active conversation's context-window fill. */
export interface ContextUsage {
  /** Tokens consumed, pre-formatted for display (e.g. '352.0k'). */
  used: string
  /** Window size, pre-formatted for display (e.g. '1.0M'). */
  total: string
  /** Percent of the context window consumed (0–100). */
  pct: number
}

/** One rolling plan-limit window (a 5-hour bucket, the weekly cap, …). */
export interface UsageWindow {
  /** Row label, e.g. '5-hour limit' or 'Weekly · all models'. */
  label: string
  /** When the window resets, e.g. 'Resets 6:39 PM' (empty when not applicable). */
  reset: string
  /** Percent of this window's ceiling consumed (0–100). */
  pct: number
}

/** The whole usage picture the gauge renders: the context disc + the limit rings.
 *  `limits` is in display order — the gauge reads [0] as the inner limit ring
 *  (5-hour) and [1] as the outer ring (weekly); the popup lists them all. */
export interface UsageSnapshot {
  context: ContextUsage
  limits: UsageWindow[]
}
