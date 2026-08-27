/** Local mirror for durable per-conversation panel intent (FWD-2 / PD34).
 *
 * The server is canonical when reachable. This account-scoped mirror gives an
 * instant first paint and keeps unsent intent while offline. `dirty` is the
 * reconciliation seam: a local act wins over an older server read until its
 * PATCH is acknowledged. Legacy unscoped/plain values are read as dirty so the
 * first server-capable open migrates them without losing the user's choice. */
import type { PanelFocus, SessionPreferences } from '../types'
import { isPanelFocus } from '../../contract/entities.ts'
import { uiPrefScope } from './uiPrefs.ts'

const KEY = 'claude-ui.panel.v1'

export interface LocalPanelPreference {
  focus: PanelFocus | null
  dirty: boolean
}

type Store = Record<string, LocalPanelPreference>

export type PanelPreferenceScope = string | null

const storageKey = (scope: PanelPreferenceScope = uiPrefScope()) => {
  return scope ? `${KEY}.${scope}` : KEY
}

function parseChoice(value: unknown, legacyScope: boolean): LocalPanelPreference | undefined {
  if (value === null) return { focus: null, dirty: true }
  if (isPanelFocus(value)) return { focus: value, dirty: true }
  if (!value || typeof value !== 'object') return undefined
  const row = value as { focus?: unknown; dirty?: unknown }
  if (row.focus !== null && !isPanelFocus(row.focus)) return undefined
  if (typeof row.dirty !== 'boolean') return undefined
  return { focus: row.focus, dirty: legacyScope || row.dirty }
}

function parseStore(raw: string | null, legacyScope: boolean): Store {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const next: Store = {}
    for (const [sessionId, value] of Object.entries(parsed as Record<string, unknown>)) {
      const choice = parseChoice(value, legacyScope)
      if (choice) next[sessionId] = choice
    }
    return next
  } catch {
    return {}
  }
}

function load(scope: PanelPreferenceScope = uiPrefScope()): Store {
  try {
    const current = localStorage.getItem(storageKey(scope))
    if (current !== null) return parseStore(current, false)
    // Per-account first read inherits the old unscoped store, then its first
    // write diverges into the account key (the same migration rule as uiPrefs).
    if (scope) return parseStore(localStorage.getItem(KEY), true)
  } catch {
    // Quota/privacy mode: the server command still runs; this is only a mirror.
  }
  return {}
}

function save(store: Store, scope: PanelPreferenceScope = uiPrefScope()): void {
  try {
    localStorage.setItem(storageKey(scope), JSON.stringify(store))
  } catch {
    /* server remains authoritative */
  }
}

export function samePanelFocus(a: PanelFocus | null, b: PanelFocus | null): boolean {
  return a === null || b === null ? a === b : a.kind === b.kind && a.id === b.id
}

export function getPanelPrefState(
  sessionId: string,
  scope: PanelPreferenceScope = uiPrefScope(),
): LocalPanelPreference | undefined {
  return load(scope)[sessionId]
}

export function getPanelPref(sessionId: string): PanelFocus | null | undefined {
  return getPanelPrefState(sessionId)?.focus
}

/** Remember a local act immediately. It stays dirty until the matching server
 * response is acknowledged; a stale response can therefore never erase a
 * newer click. */
export function setPanelPref(
  sessionId: string,
  focus: PanelFocus | null,
  scope: PanelPreferenceScope = uiPrefScope(),
): void {
  save({ ...load(scope), [sessionId]: { focus, dirty: true } }, scope)
}

/** Merge a successful server read into the mirror. Dirty local intent wins;
 * otherwise the server's absent/null/focus tri-state becomes local truth. */
export function adoptServerPanelPref(
  sessionId: string,
  preferences: SessionPreferences | undefined,
  scope: PanelPreferenceScope = uiPrefScope(),
): PanelFocus | null | undefined {
  const store = load(scope)
  if (store[sessionId]?.dirty) return store[sessionId].focus
  if (preferences === undefined) return store[sessionId]?.focus
  if (!Object.prototype.hasOwnProperty.call(preferences, 'panelFocus')) {
    if (sessionId in store) {
      const rest = { ...store }
      delete rest[sessionId]
      save(rest, scope)
    }
    return undefined
  }
  const focus = preferences.panelFocus
  if (focus !== null && !isPanelFocus(focus)) return store[sessionId]?.focus
  save({ ...store, [sessionId]: { focus, dirty: false } }, scope)
  return focus
}

/** Mark only the exact write that came back as clean. A newer local choice
 * stays dirty and will be sent by the serialized controller queue. */
export function acknowledgePanelPref(
  sessionId: string,
  expected: PanelFocus | null,
  returned: SessionPreferences,
  scope: PanelPreferenceScope = uiPrefScope(),
): void {
  const state = getPanelPrefState(sessionId, scope)
  if (!state?.dirty || !samePanelFocus(state.focus, expected)) return
  if (!Object.prototype.hasOwnProperty.call(returned, 'panelFocus')) return
  const actual = returned.panelFocus
  if (actual !== null && !isPanelFocus(actual)) return
  if (!samePanelFocus(expected, actual)) return
  save({ ...load(scope), [sessionId]: { focus: actual, dirty: false } }, scope)
}

// The per-session split-frame memory (`claude-ui.split.v1`, spec ADAPT-16) was
// retired with the right frame — several context panes now tile through the
// per-account universal split tree (src/lib/mainSplit.ts).
