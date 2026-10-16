import type { ModelInfo, ModelProvider } from './providers.ts'

/** Model metadata overrides the provider vocabulary, including an explicitly
 * empty list. Relay sessions never acquire endpoint effort parameters. */
export function effortLevelsFor(provider?: ModelProvider, model?: ModelInfo): string[] {
  if (provider?.kind === 'session') return []
  return model?.effortLevels ?? provider?.effortLevels ?? []
}

/** One display/execution rule for personal intent: preserve an exact supported
 * choice, otherwise use High when offered, then the first declared level.
 * Empty vocabulary means omit effort, not an invented provider capability. */
export function resolveEffort(levels: string[], preference?: string): string | undefined {
  if (preference && levels.includes(preference)) return preference
  return levels.includes('High') ? 'High' : levels[0]
}
