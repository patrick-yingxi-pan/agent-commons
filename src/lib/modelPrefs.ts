/** ── Default model+effort preference ────────────────────────────────────────
 *  The composer's model/effort choice is a sticky manual setting persisted in
 *  localStorage (no adaptive guessing). The Customize page's "Default model" edits
 *  the SAME setting, so the two share one source of truth — change it in either
 *  place and new sessions start there. This module owns the shape, the storage key,
 *  and the (pure, testable) parse; load/save are the thin localStorage wrappers. */
import type { Effort, ModelId } from './models'

export interface ModelPrefs {
  modelId: ModelId
  effort: Effort
  /** Orthogonal modes — run as a multi-agent workflow / faster Opus streaming. */
  ultracode: boolean
  fast: boolean
}

export const DEFAULT_MODEL_PREFS: ModelPrefs = { modelId: 'opus', effort: 'high', ultracode: false, fast: false }

const STORAGE_KEY = 'claude-ui.composer.modelEffort.v1'

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

export function loadModelPrefs(): ModelPrefs {
  try {
    return parseModelPrefs(localStorage.getItem(STORAGE_KEY))
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
