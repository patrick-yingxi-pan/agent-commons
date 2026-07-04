/** ── Model + effort catalog ─────────────────────────────────────────────────
 *  One source of truth for the Claude models and the reasoning-effort ladder, so
 *  the composer's Model control and the scheduled-routine Model picker pick from
 *  the same list. A routine stores its model as a label string ("Claude Opus 4.8 ·
 *  High"); compose/parse bridge that string and the structured choice. Pure +
 *  framework-free (no React) so the bridges are unit-tested.
 *
 *  The composer's full model list is NOT this const alone: `providerModelOptions`
 *  below appends every registered Model provider (D9) from the live registry, so a
 *  provider minted in the Models section is immediately selectable as a session's
 *  model. The Claude trio here is the catalog of the *default* provider. */
import { DEFAULT_PROVIDER_ID, type ModelProvider } from '../../contract/index.ts'

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export type ModelId = 'opus' | 'sonnet' | 'haiku'

export const MODELS = [
  { id: 'opus', name: 'Claude Opus 4.8', short: 'Opus 4.8', blurb: 'Most capable — best for hard reasoning & code.', isOpus: true },
  { id: 'sonnet', name: 'Claude Sonnet 4.6', short: 'Sonnet 4.6', blurb: 'Fast and balanced for everyday work.', isOpus: false },
  { id: 'haiku', name: 'Claude Haiku 4.5', short: 'Haiku 4.5', blurb: 'Fastest — for lightweight tasks.', isOpus: false },
] as const

export const EFFORTS: { id: Effort; label: string; blurb: string }[] = [
  { id: 'low', label: 'Low', blurb: 'Quick replies, minimal reasoning.' },
  { id: 'medium', label: 'Medium', blurb: 'Balanced speed and depth.' },
  { id: 'high', label: 'High', blurb: 'Deeper, step-by-step reasoning.' },
  { id: 'xhigh', label: 'xHigh', blurb: 'Extended reasoning for hard, multi-file work.' },
  { id: 'max', label: 'Max', blurb: 'Maximum reasoning for the hardest problems.' },
]

/** One registered Model provider rendered as a selectable model — the live half of
 *  the composer's list (the Claude trio above is the static half: the default
 *  provider's own catalog). Picking one sets the SESSION's `providerId`, so the turn
 *  genuinely routes through that provider — this is wiring, not preference. */
export interface ProviderModelOption {
  providerId: string
  name: string
  blurb: string
  kind: 'endpoint' | 'session'
  /** Session kind only: whether a drain loop is currently bound (the status dot). */
  online?: boolean
  /** The provider's own effort vocabulary — provider-local, NOT the ladder above. */
  effortLevels: string[]
}

/** Project the provider registry into model options. The seeded default provider is
 *  deliberately excluded — its catalog is the built-in Claude trio (an unset pick),
 *  so listing it again would offer the same cognition under two rows. Pure, so the
 *  registry→list sync is unit-tested. */
export function providerModelOptions(providers: ModelProvider[]): ProviderModelOption[] {
  return providers
    .filter((p) => p.id !== DEFAULT_PROVIDER_ID)
    .map((p) => ({
      providerId: p.id,
      name: p.label,
      blurb:
        p.kind === 'session'
          ? 'Your own AI session answers — prose only.'
          : `A Messages endpoint you registered (${p.modelFamily}).`,
      kind: p.kind ?? 'endpoint',
      online: p.online,
      effortLevels: p.effortLevels,
    }))
}

/** A picker's current selection — either a built-in Claude model (+ effort) or a
 *  registered provider. The one shape all three model pickers (composer, routine,
 *  Customize default) resolve to, so "which model is chosen" parses identically
 *  everywhere. */
export type ModelChoice =
  | { kind: 'builtin'; modelId: ModelId; effort: Effort }
  | { kind: 'provider'; providerId: string }

/** Parse a stored model label against the live provider options: a registered
 *  provider's label names that provider; anything else parses as the built-in trio
 *  (falling back to Opus · High). A renamed or deleted provider therefore degrades
 *  to the default rather than throwing — same tolerance as `parseModelLabel`.
 *  Named trade-off of label-as-storage: providers match FIRST, so a provider
 *  deliberately labeled like a composed built-in label ("Claude Opus 4.8 · High")
 *  shadows it on re-parse. Accepted — labels here are descriptive routine fields
 *  (runs are mock-synthesized), and session routing uses ids, never this parse. */
export function parseModelChoice(label: string, options: ProviderModelOption[]): ModelChoice {
  const provider = options.find((o) => o.name === label)
  if (provider) return { kind: 'provider', providerId: provider.providerId }
  return { kind: 'builtin', ...parseModelLabel(label) }
}

/** The routine's stored model label, e.g. "Claude Opus 4.8 · High". */
export function composeModelLabel(modelId: ModelId, effort: Effort): string {
  const m = MODELS.find((x) => x.id === modelId) ?? MODELS[0]
  const e = EFFORTS.find((x) => x.id === effort) ?? EFFORTS[2]
  return `${m.name} · ${e.label}`
}

/** Best-effort parse of a stored model label back into the structured choice, so a
 *  picker opens pre-selected. Falls back to Opus · High (the product default) for
 *  anything unrecognized — never throws. */
export function parseModelLabel(label: string): { modelId: ModelId; effort: Effort } {
  const model = MODELS.find((m) => label.includes(m.name) || label.includes(m.short))
  const effort = EFFORTS.find((e) => new RegExp(`·\\s*${e.label}\\b`, 'i').test(label))
  return { modelId: model?.id ?? 'opus', effort: effort?.id ?? 'high' }
}
