/** ── Model selection, projected from the provider registry ──────────────────
 *  The UI carries NO model catalog of its own: every model a picker lists comes
 *  from the live provider registry (`ModelProvider.models` — each provider's own
 *  catalog, fetched from its endpoint's list API or declared at registration).
 *  The default provider's catalog is what used to be the hard-coded Claude trio;
 *  registering a provider makes its models pickable everywhere at once (the
 *  "registries have one home" rule, locked by src/components/model-picker.test.ts).
 *
 *  A selection is a two-level **pick** — `{ providerId?, modelId? }` — where each
 *  absence is an inherit (INV-9's shape at the client): no providerId = the
 *  default provider (an unset session pick), no modelId = the provider's own
 *  configured model. Every metadata field on a catalog model is optional
 *  (providers disagree wildly — see contract `ModelInfo`), so the projections
 *  here degrade per-field. Pure + framework-free (no React) so they're
 *  unit-tested. */
import { DEFAULT_PROVIDER_ID, formatTokens, type ModelInfo, type ModelProvider } from '../../contract/index.ts'

/** A picker's two-level selection. Absences inherit: providerId → the default
 *  provider; modelId → the provider's configured model. */
export interface ModelPick {
  providerId?: string
  modelId?: string
}

/** The provider a pick lands on, resolved against the live registry (undefined
 *  while the registry hasn't loaded, or for a stale pick of a deleted provider). */
export function pickedProvider(providers: ModelProvider[], pick?: ModelPick): ModelProvider | undefined {
  return providers.find((p) => p.id === (pick?.providerId ?? DEFAULT_PROVIDER_ID))
}

/** The catalog model a pick shows/acts on: the picked entry, else what an unset
 *  pick actually resolves to — the provider's configured model (the server-stamped
 *  `defaultModelId`, so the display can't drift from what a turn runs), else the
 *  catalog's first as the last-resort pre-selection. Undefined when the provider
 *  can't enumerate models (a Session provider's cognition is whatever session
 *  drains its mailbox; a list-less endpoint). */
export function pickedModel(provider: ModelProvider | undefined, pick?: ModelPick): ModelInfo | undefined {
  if (!provider || provider.kind === 'session') return undefined
  const catalog = provider.models ?? []
  return (
    catalog.find((m) => m.id === pick?.modelId) ??
    catalog.find((m) => m.id === provider.defaultModelId) ??
    catalog[0]
  )
}

/** The effort vocabulary in force for a pick: the model's own levels when it
 *  declares them, else the provider's — empty = no effort control at all. */
export function effortLevelsFor(provider?: ModelProvider, model?: ModelInfo): string[] {
  return model?.effortLevels ?? provider?.effortLevels ?? []
}

/** Resolve a stored effort preference against the vocabulary in force: an exact
 *  member survives; anything else pre-selects 'High' when offered, else the first
 *  level (a pure UI pre-selection, INV-9's convenient edge). Undefined only for
 *  an empty vocabulary. */
export function resolveEffort(levels: string[], pref?: string): string | undefined {
  if (pref && levels.includes(pref)) return pref
  return levels.includes('High') ? 'High' : levels[0]
}

/** Blurbs for the classic ladder labels (shown under the segmented control when
 *  the active vocabulary uses them; an unfamiliar provider vocabulary gets none). */
export const EFFORT_BLURBS: Record<string, string> = {
  Low: 'Quick replies, minimal reasoning.',
  Medium: 'Balanced speed and depth.',
  High: 'Deeper, step-by-step reasoning.',
  xHigh: 'Extended reasoning for hard, multi-file work.',
  Max: 'Maximum reasoning for the hardest problems.',
}

/** Trigger-sized model name ('Claude Opus 4.8' → 'Opus 4.8'). */
export function shortModelLabel(label: string): string {
  return label.replace(/^Claude\s+/, '')
}

/** Whether a catalog model is Opus-class — gates the composer's Fast-output
 *  toggle (fast mode is an Opus affordance). */
export function isOpusModel(id?: string): boolean {
  return /opus/i.test(id ?? '')
}

/** A catalog row's caption, derived from the provider's own metadata — each
 *  fragment appears only when the provider exposed it (the per-field degradation
 *  the flexible `ModelInfo` demands). */
export function modelBlurb(m: ModelInfo): string {
  const bits = [
    ...(m.blurb ? [m.blurb] : []),
    ...(m.contextWindow ? [`${formatTokens(m.contextWindow)} context`] : []),
    ...(m.capabilities?.thinking ? ['thinking'] : []),
    ...(m.pricing ? [`$${m.pricing.inputPerMTok}/M in · $${m.pricing.outputPerMTok}/M out`] : []),
    ...(m.deprecated ? ['deprecated'] : []),
  ]
  return bits.join(' · ') || 'No metadata from this provider.'
}

/** What the trigger button shows for a pick: the default provider reads as its
 *  model (+ effort) — 'Opus 4.8 · High'; a registered provider leads with its
 *  own label — 'OpenRouter · Llama 3 70B', or just the label when it can't
 *  enumerate models. */
export function displayModelLabel(providers: ModelProvider[], pick?: ModelPick, effort?: string): string {
  const provider = pickedProvider(providers, pick)
  if (!provider) return 'Model'
  const model = pickedModel(provider, pick)
  if (provider.id === DEFAULT_PROVIDER_ID) {
    if (!model) return provider.label
    return effort ? `${shortModelLabel(model.label)} · ${effort}` : shortModelLabel(model.label)
  }
  return model && pick?.modelId ? `${provider.label} · ${shortModelLabel(model.label)}` : provider.label
}

/** A routine's stored model field is a descriptive LABEL (runs are
 *  mock-synthesized; session routing uses ids, never this string). Composed so
 *  `parseModelChoice` round-trips it: the default provider stores
 *  'Claude Opus 4.8 · High' (back-compatible with previously stored labels);
 *  a registered provider stores 'Provider · Model' or its bare label. */
export function composeModelLabel(providers: ModelProvider[], pick: ModelPick, effort?: string): string {
  const provider = pickedProvider(providers, pick)
  if (!provider) return 'Claude'
  const model = pickedModel(provider, pick)
  if (provider.id === DEFAULT_PROVIDER_ID) {
    if (!model) return provider.label
    return effort ? `${model.label} · ${effort}` : model.label
  }
  return model && pick.modelId ? `${provider.label} · ${model.label}` : provider.label
}

/** Best-effort parse of a stored label back into a pick (+ effort), against the
 *  live registry — so a picker opens pre-selected. Registered providers match
 *  first (by label, then by 'Provider · Model'); anything else parses against the
 *  default provider's catalog; a renamed/deleted provider or unknown model
 *  degrades to the default pick rather than throwing. Named trade-off of
 *  label-as-storage (accepted): a provider deliberately labeled like a composed
 *  default label shadows it on re-parse. */
export function parseModelChoice(label: string, providers: ModelProvider[]): { pick: ModelPick; effort?: string } {
  for (const p of providers) {
    if (p.id === DEFAULT_PROVIDER_ID) continue
    if (label === p.label) return { pick: { providerId: p.id } }
    if (label.startsWith(`${p.label} · `)) {
      const rest = label.slice(p.label.length + 3)
      const model = (p.models ?? []).find((m) => m.label === rest || shortModelLabel(m.label) === rest)
      return { pick: { providerId: p.id, ...(model ? { modelId: model.id } : {}) } }
    }
  }
  const fallback = providers.find((p) => p.id === DEFAULT_PROVIDER_ID)
  const model = (fallback?.models ?? []).find((m) => label.includes(m.label) || label.includes(shortModelLabel(m.label)))
  const levels = effortLevelsFor(fallback, model)
  // Effort levels are a provider's OWN catalog strings (caller-suppliable via
  // POST/PATCH /providers), so they may carry regex metacharacters — a level of
  // `C++` or `A+` would make an unescaped interpolation throw and crash the
  // picker's render. Match on the segment after the `·`, no regex.
  const effort = levels.find((l) => label.split('·').some((seg) => seg.trim().toLowerCase() === l.toLowerCase()))
  return { pick: { ...(model ? { modelId: model.id } : {}) }, ...(effort ? { effort } : {}) }
}
