/** Pure model-preference projection. The server's viewer-scoped record is the
 * authority; an unscoped browser blob cannot establish which person chose it.
 * Legacy parsers remain for explicit import/compatibility tests, never boot. */
import { DEFAULT_MODEL_PREFERENCES, type ModelPreferences } from '../../contract/modelPreferences.ts'

export type ModelPrefs = ModelPreferences
export const DEFAULT_MODEL_PREFS = DEFAULT_MODEL_PREFERENCES
const LEGACY_MODEL_IDS: Record<string, string> = {
  opus: 'claude-opus-4-8',
  sonnet: 'claude-sonnet-4-6',
  haiku: 'claude-haiku-4-5',
}
const LEGACY_EFFORTS: Record<string, string> = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'xHigh', max: 'Max' }

/** Merge a stored blob over the defaults — tolerant of partial / corrupt JSON so a
 *  bad value never throws (it just falls back). Pure, so it's unit-tested. */
export function parseModelPrefs(raw: string | null): ModelPrefs {
  if (!raw) return DEFAULT_MODEL_PREFS
  try {
    return { ...DEFAULT_MODEL_PREFS, ...(JSON.parse(raw) as Partial<ModelPrefs>) }
  } catch {
    return DEFAULT_MODEL_PREFS
  }
}

/** Map a v1 blob (built-in trio ids + lowercase effort + `defaultProviderId`)
 *  onto the v2 pick shape. Pure, so the migration is unit-tested. */
export function migrateLegacyPrefs(raw: string | null): ModelPrefs | undefined {
  if (!raw) return undefined
  try {
    const v1 = JSON.parse(raw) as { modelId?: string; effort?: string; ultracode?: boolean; fast?: boolean; defaultProviderId?: string }
    return {
      ...DEFAULT_MODEL_PREFS,
      ...(v1.defaultProviderId
        ? { providerId: v1.defaultProviderId }
        : v1.modelId && LEGACY_MODEL_IDS[v1.modelId]
          ? { modelId: LEGACY_MODEL_IDS[v1.modelId] }
          : {}),
      ...(v1.effort && LEGACY_EFFORTS[v1.effort] ? { effort: LEGACY_EFFORTS[v1.effort] } : {}),
      ultracode: v1.ultracode ?? false,
      fast: v1.fast ?? false,
    }
  } catch {
    return undefined
  }
}

export function applyModelPreferencePatch(current: ModelPrefs, patch: Partial<ModelPrefs>): ModelPrefs {
  const next = { ...current, ...patch }
  return {
    ...(next.providerId !== undefined ? { providerId: next.providerId } : {}),
    ...(next.modelId !== undefined ? { modelId: next.modelId } : {}),
    ...(next.effort !== undefined ? { effort: next.effort } : {}),
    ultracode: next.ultracode,
    fast: next.fast,
  }
}

export function sameModelPreferences(a: ModelPrefs, b: ModelPrefs): boolean {
  return a.providerId === b.providerId && a.modelId === b.modelId && a.effort === b.effort &&
    a.ultracode === b.ultracode && a.fast === b.fast
}
