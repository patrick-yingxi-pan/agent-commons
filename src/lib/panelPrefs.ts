/** Per-conversation panel memory (FWD-2 / PD34). Remembers which right-panel a session
 *  last had open — a `PanelFocus`, or `null` for explicitly closed — so reopening the
 *  session (after a reload or a switch) restores *your* choice instead of always
 *  re-deriving the strongest context. `undefined` means no stored choice, so the caller
 *  falls back to `strongestFocus`.
 *
 *  localStorage-backed: the design's stated fallback for a (forthcoming) cross-device,
 *  server-side `ui_prefs`. Per session, never evicted; survives a reload. */
import type { PanelFocus } from '../types'
import type { SplitNode } from './splitFrame'

const KEY = 'claude-ui.panel.v1'
type Store = Record<string, PanelFocus | null>

function load(): Store {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Store) : {}
  } catch {
    return {}
  }
}

/** The stored panel for a session: a `PanelFocus`, `null` (explicitly closed), or
 *  `undefined` (no stored choice → fall back to the default). */
export function getPanelPref(sessionId: string): PanelFocus | null | undefined {
  const store = load()
  return sessionId in store ? store[sessionId] : undefined
}

/** Remember a session's panel choice (a focus, or null for closed). */
export function setPanelPref(sessionId: string, focus: PanelFocus | null): void {
  const next = { ...load(), [sessionId]: focus }
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* ignore quota / privacy-mode errors */
  }
}

/** ── Per-session split-frame memory (spec ADAPT-16) ──────────────────────────
 *  The panel area's split tree, remembered like the focus above: reopening a
 *  session restores its tiling (pruned against what still exists). `null` /
 *  absent = no frame — the legacy single panel. Same localStorage posture. */
const SPLIT_KEY = 'claude-ui.split.v1'
type SplitStore = Record<string, SplitNode | null>

function loadSplit(): SplitStore {
  try {
    const raw = localStorage.getItem(SPLIT_KEY)
    return raw ? (JSON.parse(raw) as SplitStore) : {}
  } catch {
    return {}
  }
}

export function getSplitPref(sessionId: string): SplitNode | null {
  return loadSplit()[sessionId] ?? null
}

export function setSplitPref(sessionId: string, tree: SplitNode | null): void {
  const next = { ...loadSplit(), [sessionId]: tree }
  try {
    localStorage.setItem(SPLIT_KEY, JSON.stringify(next))
  } catch {
    /* ignore quota / privacy-mode errors */
  }
}
