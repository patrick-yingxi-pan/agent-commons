/** ── Theme preference (Light / Dark / System) ───────────────────────────────
 *  The Customize page's Appearance control edits a sticky localStorage pref;
 *  this module owns the shape, the storage key, the (pure, testable) parse and
 *  resolution, and the ONE apply funnel: `data-theme="light" | "dark"` stamped
 *  on <html>, which flips the `[data-theme="dark"]` variable block in
 *  src/index.css. "system" resolves against `prefers-color-scheme` at apply
 *  time and re-resolves live when the OS setting changes (the matchMedia
 *  listener) or another tab edits the pref (the storage listener). Nothing else
 *  may touch `data-theme` — invariant INV-1 (tests/theme.test.ts,
 *  tests/spec-conformance.test.ts). */

export type ThemePref = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

export const THEME_PREFS: readonly ThemePref[] = ['light', 'dark', 'system']
export const DEFAULT_THEME_PREF: ThemePref = 'system'

const STORAGE_KEY = 'claude-ui.customize.theme'
const DARK_QUERY = '(prefers-color-scheme: dark)'

/** Tolerant parse — anything but a known pref falls back to the default, so a
 *  corrupt value never throws and never strands the UI in a broken theme. */
export function parseThemePref(raw: string | null): ThemePref {
  return (THEME_PREFS as readonly string[]).includes(raw ?? '') ? (raw as ThemePref) : DEFAULT_THEME_PREF
}

/** The pure resolution: an explicit pick wins; "system" follows the OS. */
export function resolveTheme(pref: ThemePref, systemDark: boolean): ResolvedTheme {
  if (pref === 'system') return systemDark ? 'dark' : 'light'
  return pref
}

export function loadThemePref(): ThemePref {
  try {
    return parseThemePref(localStorage.getItem(STORAGE_KEY))
  } catch {
    return DEFAULT_THEME_PREF
  }
}

/** Persist AND apply — the setting takes effect the moment it's chosen. */
export function saveThemePref(pref: ThemePref): void {
  try {
    localStorage.setItem(STORAGE_KEY, pref)
  } catch {
    /* ignore quota / privacy-mode errors */
  }
  applyThemePref(pref)
}

function systemPrefersDark(): boolean {
  return typeof matchMedia === 'function' && matchMedia(DARK_QUERY).matches
}

function applyThemePref(pref: ThemePref): void {
  document.documentElement.dataset.theme = resolveTheme(pref, systemPrefersDark())
}

/** Boot-time wiring (main.tsx): apply the stored pref, then keep it live —
 *  re-resolve on OS theme changes (only observable under "system") and on
 *  cross-tab pref edits. */
export function initTheme(): void {
  applyThemePref(loadThemePref())
  if (typeof matchMedia === 'function') {
    matchMedia(DARK_QUERY).addEventListener('change', () => applyThemePref(loadThemePref()))
  }
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) applyThemePref(parseThemePref(e.newValue))
  })
}
