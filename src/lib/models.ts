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
import { DEFAULT_PROVIDER_ID, type ModelInfo, type ModelProvider } from '../../contract/index.ts'
import { providerModelChoices } from '../../contract/providers.ts'
export { effortLevelsFor, resolveEffort } from '../../contract/modelEffort.ts'

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
 *  has neither a catalog nor an available configured endpoint model. */
export function pickedModel(provider: ModelProvider | undefined, pick?: ModelPick): ModelInfo | undefined {
  if (!provider || provider.kind === 'session') return undefined
  const catalog = providerModelChoices(provider)
  return (
    catalog.find((m) => m.id === pick?.modelId) ??
    catalog.find((m) => m.id === provider.defaultModelId) ??
    catalog[0]
  )
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
