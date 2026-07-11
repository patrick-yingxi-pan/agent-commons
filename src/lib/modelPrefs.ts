/** ── Default model+effort preference ────────────────────────────────────────
 *  The composer's model/effort choice is a sticky manual setting persisted in
 *  localStorage (no adaptive guessing). The Customize page's "Default model" edits
 *  the SAME setting, so the two share one source of truth — change it in either
 *  place and new sessions start there. This module owns the shape, the storage key,
 *  and the (pure, testable) parse; load/save are the thin localStorage wrappers.
 *
 *  The pref stores a two-level **pick** (lib/models `ModelPick`) plus an effort
 *  LABEL — all registry-relative and all optional (absence = inherit: the default
 *  provider / its configured model / its pre-selected effort). A stale pick — a
 *  deleted provider, a model its catalog dropped — degrades at use: the pickers
 *  resolve against the live registry and the send-path sanitizes before writing. */
import type { ModelPick } from './models'

export interface ModelPrefs extends ModelPick {
  /** Preferred effort LABEL within the active vocabulary (provider-local, e.g.
   *  'High') — resolved against the live levels at use (`resolveEffort`). */
  effort?: string
  /** Orthogonal modes — run as a multi-agent workflow / faster Opus streaming. */
  ultracode: boolean
  fast: boolean
}

export const DEFAULT_MODEL_PREFS: ModelPrefs = { effort: 'High', ultracode: false, fast: false }

const STORAGE_KEY = 'claude-ui.composer.modelEffort.v2'
/** The pre-catalog shape ('opus'/'high' + defaultProviderId) — migrated on load. */
const LEGACY_STORAGE_KEY = 'claude-ui.composer.modelEffort.v1'
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

export function loadModelPrefs(): ModelPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return parseModelPrefs(raw)
    const migrated = migrateLegacyPrefs(localStorage.getItem(LEGACY_STORAGE_KEY))
    if (migrated) {
      saveModelPrefs(migrated) // one-time upgrade; v1 stays behind for old builds
      return migrated
    }
    return DEFAULT_MODEL_PREFS
  } catch {
    return DEFAULT_MODEL_PREFS
  }
}

export function saveModelPrefs(prefs: ModelPrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
  } catch {
    /* ignore quota / privacy-mode errors */
  }
}
