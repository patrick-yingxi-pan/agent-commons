/** Compatibility for label-only Routine rows. Ordinary composer startup and
 * execution use structured identity; only deferred Routine surfaces need this. */
import { DEFAULT_PROVIDER_ID, type ModelProvider } from '../../contract/index.ts'
import { effortLevelsFor } from '../../contract/modelEffort.ts'
import { pickedProvider, pickedModel, shortModelLabel, type ModelPick } from './models.ts'

/** A routine's stored model field is a compatibility/display LABEL; durable
 * execution routes through providerId/modelId and never this string. */
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

/** Best-effort parse against the live registry. Registered providers match
 * first; unknown labels inherit the default. An identically labeled registered
 * provider deliberately shadows a composed default label on re-parse. */
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
  // Caller-supplied levels may contain regex metacharacters such as C++.
  // Match complete segments rather than interpolating a regular expression.
  const effort = levels.find((l) => label.split('·').some((seg) => seg.trim().toLowerCase() === l.toLowerCase()))
  return { pick: { ...(model ? { modelId: model.id } : {}) }, ...(effort ? { effort } : {}) }
}
