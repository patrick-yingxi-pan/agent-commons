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

// ── Pure metering helpers (shared by server + client) ────────────────────────
// Kept here, with the types, so the server's meter and the client's live context
// gauge agree on the math — the same reason `ids.ts` holds shared id invariants.

/** The model's context window (Opus-class), in tokens. */
export const CONTEXT_WINDOW = 200_000

/** Fixed context overhead every turn carries — the system prompt + the tool schema
 *  the backend sends each request — so even an empty thread shows a little context
 *  in use (as it really does). */
export const SYSTEM_BASELINE = 1_200

/** Rough token estimate for a piece of text (≈ 4 characters per token — the
 *  standard rule of thumb; a real backend would meter exactly). */
export function estimateTokens(text: string): number {
  return Math.ceil((text?.length ?? 0) / 4)
}

/** Format a token count for the gauge label: '850' · '12.3k' · '1.4M'. */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(Math.round(n))
}

/** The context-window fill (the inner disc) for a conversation of `tokens` size —
 *  the live figure the composer computes from the open thread. */
export function contextUsage(tokens: number): ContextUsage {
  const t = Math.max(0, tokens)
  return { used: formatTokens(t), total: formatTokens(CONTEXT_WINDOW), pct: Math.min(100, Math.round((t / CONTEXT_WINDOW) * 100)) }
}
