/** ── Contract: usage metering ───────────────────────────────────────────────
 *  What the composer's usage gauge (and its popup) read. One snapshot covers the
 *  active conversation's context window plus the plan's rolling limit windows
 *  (5-hour, weekly, …), each expressed as a percent of its own ceiling.
 *
 *  Server-owned: in the real product these come from the account's live metering
 *  (and the context figure from the open session); here they're a seeded fixture
 *  served over the API, so the UI's copy is a cache, not a source of truth. */

/** A swatch tone for one context-breakdown category — the legend dot + the
 *  stacked-bar segment share it. */
export type ContextTone =
  | 'messages'
  | 'skills'
  | 'memory'
  | 'systemTools'
  | 'systemPrompt'
  | 'agents'
  | 'mcp'
  | 'free'

/** One category of the context-window breakdown — what's occupying the model's
 *  context (or, for deferred rows, what *could* be loaded on demand). */
export interface ContextSegment {
  id: string
  label: string
  /** Raw token count — drives the stacked-bar widths + ordering. */
  rawTokens: number
  /** Pre-formatted token count for the row (e.g. '12.5k'). */
  tokens: string
  /** Percent of the window (0–100, one decimal); undefined for deferred rows,
   *  which render a '—' since they aren't counted against the window yet. */
  pct?: number
  tone: ContextTone
  /** Loaded on demand, not currently counted against the window. */
  deferred?: boolean
  /** Item count for categories that are collections (memory files, custom
   *  agents, MCP tools) — the screenshot's right-hand count column. */
  count?: number
}

/** The active conversation's context-window fill, with its per-category breakdown. */
export interface ContextUsage {
  /** Tokens consumed, pre-formatted for display (e.g. '404.7k'). */
  used: string
  /** Window size, pre-formatted for display (e.g. '1.0M'). */
  total: string
  /** Percent of the context window consumed (0–100). */
  pct: number
  /** The breakdown rows, in display order: the loaded categories, then Free
   *  space, then the deferred categories. */
  segments: ContextSegment[]
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

/** The model's context window (Opus-class, extended), in tokens. */
export const CONTEXT_WINDOW = 1_000_000

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

/** The non-message context categories — the workspace/account overhead the model
 *  carries alongside the conversation. The token counts are seed composition (the
 *  prototype's workspace config), the same way projects/artifacts are seeded;
 *  `Messages` is the one live, real category, computed from the open thread. The
 *  fixed sum here is the empty-thread baseline (what a brand-new chat already
 *  occupies). */
const CONTEXT_CONFIG: ReadonlyArray<Omit<ContextSegment, 'tokens' | 'pct'>> = [
  { id: 'skills', label: 'Skills', rawTokens: 12_500, tone: 'skills' },
  { id: 'memory', label: 'Memory files', rawTokens: 7_200, tone: 'memory', count: 4 },
  { id: 'systemTools', label: 'System tools', rawTokens: 4_800, tone: 'systemTools' },
  { id: 'systemPrompt', label: 'System prompt', rawTokens: 3_300, tone: 'systemPrompt' },
  { id: 'agents', label: 'Custom agents', rawTokens: 2_000, tone: 'agents', count: 6 },
]
/** Deferred categories — available but loaded on demand, so not counted against
 *  the window (rendered with a '—'). */
const CONTEXT_DEFERRED: ReadonlyArray<Omit<ContextSegment, 'tokens' | 'pct'>> = [
  { id: 'mcp', label: 'MCP tools', rawTokens: 22_500, tone: 'mcp', deferred: true, count: 75 },
  { id: 'systemToolsDeferred', label: 'System tools (deferred)', rawTokens: 12_700, tone: 'systemTools', deferred: true },
]

/** The fixed (non-message) context an empty thread already occupies — the sum of
 *  the loaded config categories. */
export const CONTEXT_BASELINE = CONTEXT_CONFIG.reduce((n, s) => n + s.rawTokens, 0)

const seg = (s: Omit<ContextSegment, 'tokens' | 'pct'>, pct?: number): ContextSegment => ({
  ...s,
  tokens: formatTokens(s.rawTokens),
  ...(pct === undefined ? {} : { pct }),
})
const pctOf = (raw: number) => Math.round((raw / CONTEXT_WINDOW) * 1000) / 10

/** The full context-window breakdown for a thread whose messages total
 *  `messageTokens` — the live figure the composer computes from the open thread,
 *  or the server from a persisted one. Messages + the loaded config make up
 *  `used`; the rest is Free space; deferred categories are listed but uncounted. */
export function contextBreakdown(messageTokens: number): ContextUsage {
  const messages = Math.max(0, messageTokens)
  const loaded: ContextSegment[] = [
    seg({ id: 'messages', label: 'Messages', rawTokens: messages, tone: 'messages' }, pctOf(messages)),
    ...CONTEXT_CONFIG.map((s) => seg(s, pctOf(s.rawTokens))),
  ]
  const usedTokens = loaded.reduce((n, s) => n + s.rawTokens, 0)
  const free = Math.max(0, CONTEXT_WINDOW - usedTokens)
  const segments: ContextSegment[] = [
    ...loaded,
    seg({ id: 'free', label: 'Free space', rawTokens: free, tone: 'free' }, pctOf(free)),
    ...CONTEXT_DEFERRED.map((s) => seg(s)), // no pct → renders '—'
  ]
  return {
    used: formatTokens(usedTokens),
    total: formatTokens(CONTEXT_WINDOW),
    pct: Math.min(100, Math.round((usedTokens / CONTEXT_WINDOW) * 100)),
    segments,
  }
}
