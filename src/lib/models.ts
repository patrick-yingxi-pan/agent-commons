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
import { providerModelSelection } from '../../contract/providers.ts'
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

/** The exact endpoint model, explicitly picked or inherited from its configured
 * default. An unavailable identity never selects another catalog entry. */
export function pickedModel(provider: ModelProvider | undefined, pick?: ModelPick): ModelInfo | undefined {
  return providerModelSelection(provider, pick?.modelId).model
}

/** Trigger-sized model name ('Claude Opus 4.8' → 'Opus 4.8'). */
export function shortModelLabel(label: string): string {
  return label.replace(/^Claude\s+/, '')
}

/** What the trigger button shows for a pick: the default provider reads as its
 *  model (+ effort) — 'Opus 4.8 · High'; a registered provider leads with its
 *  own label — 'OpenRouter · Llama 3 70B', or just the label when it can't
 *  enumerate models. */
export function displayModelLabel(providers: ModelProvider[], pick?: ModelPick, effort?: string): string {
  const provider = pickedProvider(providers, pick)
  if (!provider) return 'Model'
  const selection = providerModelSelection(provider, pick?.modelId)
  if (selection.unavailable) {
    return `${provider.id === DEFAULT_PROVIDER_ID ? '' : `${provider.label} · `}${selection.modelId} · unavailable`
  }
  const model = selection.model
  if (provider.id === DEFAULT_PROVIDER_ID) {
    if (!model) return provider.label
    return effort ? `${shortModelLabel(model.label)} · ${effort}` : shortModelLabel(model.label)
  }
  return model && pick?.modelId ? `${provider.label} · ${shortModelLabel(model.label)}` : provider.label
}
