/** ── Contract: usage metering ───────────────────────────────────────────────
 *  What the composer's usage gauge (and its popup) read. One snapshot covers the
 *  active conversation's partial context estimate plus local rolling limit windows
 *  (5-hour, weekly, …), each expressed as a percent of its own ceiling.
 *
 *  Server-owned: context categories are estimates of available inputs, while
 *  rolling counters record completed calls. Neither is a provider billing ledger;
 *  the UI caches the snapshot and may overlay live conversation text. */

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
  /** Window size, pre-formatted for display (e.g. '1.0M') — '—' when unknown. */
  total: string
  /** Percent of the context window consumed (0–100); 0 when the window is unknown
   *  (check `windowTokens` — the gauge renders unknown-capacity, not "empty"). */
  pct: number
  /** The raw context-window capacity, in tokens — sourced from the session's
   *  resolved provider+model (`ModelInfo.contextWindow`). ABSENT = the provider
   *  doesn't expose it (OpenAI-class lists, Session providers): percentages are
   *  uncomputable, so segments carry token counts only and there is no Free row. */
  windowTokens?: number
  /** The breakdown rows, in display order: the loaded categories, then Free
   *  space (when the window is known), then the deferred categories. */
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

/** The session's resolved cognition source, stamped on the usage snapshot so the
 *  composer strip reads the *provider's* facts, not a client constant: the server
 *  resolves the same chain a turn routes through (`session.providerId ??
 *  agent.providerId ?? default`, then `session.modelId ?? the provider's configured
 *  model`). `modelLabel` is absent when the resolved id isn't in the provider's
 *  catalog (or the provider has none — a Session provider's model is unknowable). */
export interface UsageModelRef {
  providerId: string
  providerLabel: string
  /** The resolved concrete model id; absent when the provider decides opaquely. */
  modelId?: string
  modelLabel?: string
}

/** The whole usage picture the gauge renders: the context disc + the limit rings.
 *  `limits` is in display order — the gauge reads [0] as the inner limit ring
 *  (5-hour) and [1] as the outer ring (weekly); the popup lists them all. */
export interface UsageSnapshot {
  context: ContextUsage
  limits: UsageWindow[]
  /** What cognition the context figures are measured against (see UsageModelRef). */
  model?: UsageModelRef
}

// ── Pure metering helpers (shared by server + client) ────────────────────────
// Kept here, with the types, so the server's meter and the client's live context
// gauge agree on the math — the same reason `ids.ts` holds shared id invariants.

/** The default provider's Opus-class (extended) context window, in tokens — the
 *  seed catalog's figure, NOT a global assumption: the live figure a gauge renders
 *  comes from the session's resolved provider+model (`ModelInfo.contextWindow`),
 *  threaded into `contextBreakdown` below, and may be absent entirely. */
export const CONTEXT_WINDOW = 1_000_000

/** Rough text estimate, not a tokenizer or complete model-request measurement. */
export function estimateTokens(text: string): number {
  return Math.ceil((text?.length ?? 0) / 4)
}

/** Format a token count for the gauge label: '850' · '12.3k' · '1.4M'. */
export function formatTokens(n: number): string {
  // Promote at the ROUNDING boundary, not the raw one: 999,999 rounds to 1000.0k,
  // which should read '1.0M'. `toFixed(1)` rounds half-up, so anything ≥ 999,950
  // renders '1000.0k' in the k-branch — bump it into the M-branch.
  if (n >= 999_950) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(Math.round(n))
}

/** Only supplied categories contribute; empty workspaces never inherit inventory. */
type SegmentSpec = Omit<ContextSegment, 'tokens' | 'pct'>

const seg = (s: SegmentSpec, pct?: number): ContextSegment => ({
  ...s,
  tokens: formatTokens(s.rawTokens),
  ...(pct === undefined ? {} : { pct }),
})

/** Close out a breakdown from its loaded categories against the resolved model's
 *  window: append Free space + the deferred rows, and compute the used/total/pct
 *  header. `windowTokens` undefined = the provider doesn't expose the window —
 *  percentages and Free space are uncomputable, so the rows carry token counts
 *  only (the honest degradation, not a fabricated capacity). */
function finalize(loaded: SegmentSpec[], windowTokens?: number, deferred: SegmentSpec[] = []): ContextUsage {
  const usedTokens = loaded.reduce((n, s) => n + s.rawTokens, 0)
  if (windowTokens === undefined) {
    return {
      used: formatTokens(usedTokens),
      total: '—',
      pct: 0,
      segments: [...loaded.map((s) => seg(s)), ...deferred.map((s) => seg(s))],
    }
  }
  const pctOf = (raw: number) => Math.round((raw / windowTokens) * 1000) / 10
  const free = Math.max(0, windowTokens - usedTokens)
  const segments: ContextSegment[] = [
    ...loaded.map((s) => seg(s, pctOf(s.rawTokens))),
    seg({ id: 'free', label: 'Free space', rawTokens: free, tone: 'free' }, pctOf(free)),
    ...deferred.map((s) => seg(s)), // no pct → renders '—'
  ]
  return {
    used: formatTokens(usedTokens),
    total: formatTokens(windowTokens),
    pct: Math.min(100, Math.round((usedTokens / windowTokens) * 100)),
    windowTokens,
    segments,
  }
}

/** Partial text estimate inputs. Runtime additions and provider-managed context
 *  are not represented; consumers must not describe this as a complete count. */
export interface ContextParts {
  /** Conversation text: live on the client, persisted on the server. */
  messageTokens: number
  /** Enabled base-tool schemas, excluding per-turn API/connector/routine tools. */
  systemToolsTokens: number
  /** Base system framing, excluding per-turn additions. */
  systemPromptTokens: number
}

/** A partial context estimate against the resolved model's
 *  window (`ModelInfo.contextWindow`; undefined = the provider doesn't expose it —
 *  unknown-capacity mode). Only the supplied categories make up `used`; the
 *  remainder is estimated Free space. No category or collection count is seeded. */
export function contextBreakdown(parts: ContextParts, windowTokens?: number): ContextUsage {
  return finalize(
    [
      { id: 'messages', label: 'Messages', rawTokens: Math.max(0, parts.messageTokens), tone: 'messages' },
      { id: 'systemTools', label: 'System tools', rawTokens: parts.systemToolsTokens, tone: 'systemTools' },
      { id: 'systemPrompt', label: 'System prompt', rawTokens: parts.systemPromptTokens, tone: 'systemPrompt' },
    ],
    windowTokens,
  )
}

/** Re-derive a breakdown with a live Messages estimate, keeping every other
 *  category from the server's snapshot. The composer calls this so the Messages
 *  row + Free space track the open thread in real time, without re-sending the
 *  server-owned tool/prompt sizes. The window carries over from the snapshot
 *  (`windowTokens`, which may be absent — unknown-capacity mode survives the
 *  overlay); passing `opts` replaces it wholesale — `{ window: n }` overlays a
 *  known capacity, `{}` an unknown one — so a draft can reflect a picked model
 *  before any server row exists to resolve it from. */
export function withLiveMessages(context: ContextUsage, messageTokens: number, opts?: { window?: number }): ContextUsage {
  const loaded: SegmentSpec[] = context.segments
    .filter((s) => !s.deferred && s.id !== 'free')
    .map(({ id, label, rawTokens, tone, count, deferred }) =>
      id === 'messages' ? { id, label, rawTokens: Math.max(0, messageTokens), tone, count, deferred } : { id, label, rawTokens, tone, count, deferred },
    )
  const deferred: SegmentSpec[] = context.segments
    .filter((s) => s.deferred)
    .map(({ id, label, rawTokens, tone, count, deferred }) => ({ id, label, rawTokens, tone, count, deferred }))
  // No segments yet (first paint before the snapshot loads) — nothing to derive.
  return loaded.length ? finalize(loaded, opts ? opts.window : context.windowTokens, deferred) : context
}
