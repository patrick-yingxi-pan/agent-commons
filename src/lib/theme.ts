/** ── Theme preference (Light / Dark / System × color palette) ────────────────
 *  The Customize page's Appearance control edits two sticky localStorage prefs;
 *  this module owns both AXES of theming, their shapes, storage keys, (pure,
 *  testable) parse and resolution, and the ONE apply funnel:
 *    • MODE — `data-theme="light" | "dark"` stamped on <html>, flipping the
 *      `[data-theme="dark"]` variable block in src/index.css. "system"
 *      resolves against `prefers-color-scheme` at apply time and re-resolves
 *      live when the OS setting changes (the matchMedia listener) or another
 *      tab edits the pref (the storage listener).
 *    • PALETTE — `data-palette="<id>"` stamped beside it, selecting one of the
 *      PALETTES below. Each palette overrides ONLY the palette-varying tokens
 *      (PALETTE_TOKENS) in both modes; the semantic ramps (ok/warn/danger,
 *      capability hues, diff colors) are theme-invariant and no palette may
 *      touch them. Claret is the base `@theme` block itself, so it has no
 *      override blocks.
 *  Nothing else may touch `data-theme` or `data-palette` — invariant INV-1
 *  (tests/theme.test.ts, tests/spec-conformance.test.ts, which also locks each
 *  palette's CSS blocks to exactly PALETTE_TOKENS, light and dark alike). */

export type ThemePref = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

export const THEME_PREFS: readonly ThemePref[] = ['light', 'dark', 'system']
export const DEFAULT_THEME_PREF: ThemePref = 'system'

const STORAGE_KEY = 'claude-ui.customize.theme'
const DARK_QUERY = '(prefers-color-scheme: dark)'

/* ── The palette axis ──────────────────────────────────────────────────────── */

export type PaletteId = 'claret' | 'terracotta' | 'indigo' | 'forest'

/** The tokens a palette varies — the neutrals, the accent family, and the user
 *  bubble. Everything else (`ok`/`warn`/`danger`, cap hues, diff colors,
 *  `on-solid`) is semantic and theme-invariant; the conformance lock fails a
 *  palette block that strays outside this list, or omits part of it. */
export const PALETTE_TOKENS: readonly string[] = [
  '--color-canvas',
  '--color-sidebar',
  '--color-surface',
  '--color-panel',
  '--color-panel-2',
  '--color-ink',
  '--color-ink-soft',
  '--color-ink-faint',
  '--color-line',
  '--color-line-strong',
  '--color-accent',
  '--color-accent-strong',
  '--color-accent-tint',
  '--color-co',
  '--color-co-strong',
  '--color-co-tint',
  '--color-userbubble',
]

/** The selectable palettes. `swatch` is the light-mode accent, duplicated here
 *  so the Customize picker can paint its dots without switching themes; the
 *  conformance lock cross-checks it against the CSS block (claret against the
 *  base `@theme`), so the copy can't drift. Claret first — it is the default
 *  and the base block. */
export const PALETTES: readonly { id: PaletteId; label: string; blurb: string; swatch: string }[] = [
  { id: 'claret', label: 'Claret', blurb: 'Claret verbs, Prussian places — the ledger bound in wine leather, ruled in navy ink.', swatch: '#93353f' },
  { id: 'terracotta', label: 'Terracotta', blurb: 'The warm Claude classic — clay on parchment.', swatch: '#c15f3c' },
  { id: 'indigo', label: 'Indigo', blurb: 'Cool ink on porcelain — the engineer’s blueprint.', swatch: '#4353c8' },
  { id: 'forest', label: 'Forest', blurb: 'Deep green on sage — the field notebook.', swatch: '#2e6b4a' },
]

export const DEFAULT_PALETTE: PaletteId = 'claret'

const PALETTE_STORAGE_KEY = 'claude-ui.customize.palette'

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

/** Tolerant parse, same contract as parseThemePref: junk falls back rather than
 *  stranding the UI (a palette this build no longer ships reads as the default). */
export function parsePalettePref(raw: string | null): PaletteId {
  return PALETTES.some((p) => p.id === raw) ? (raw as PaletteId) : DEFAULT_PALETTE
}

export function loadPalettePref(): PaletteId {
  try {
    return parsePalettePref(localStorage.getItem(PALETTE_STORAGE_KEY))
  } catch {
    return DEFAULT_PALETTE
  }
}

/** Persist AND apply — the palette takes effect the moment it's chosen. */
export function savePalettePref(id: PaletteId): void {
  try {
    localStorage.setItem(PALETTE_STORAGE_KEY, id)
  } catch {
    /* ignore quota / privacy-mode errors */
  }
  applyPalettePref(id)
}

function systemPrefersDark(): boolean {
  return typeof matchMedia === 'function' && matchMedia(DARK_QUERY).matches
}

function applyThemePref(pref: ThemePref): void {
  document.documentElement.dataset.theme = resolveTheme(pref, systemPrefersDark())
}

function applyPalettePref(id: PaletteId): void {
  // Always stamped, the default included — an absent attribute and a stamped
  // default must be the same state, and always-stamped is the auditable one.
  document.documentElement.dataset.palette = id
}

/** Boot-time wiring (main.tsx): apply both stored prefs, then keep them live —
 *  re-resolve on OS theme changes (only observable under "system") and on
 *  cross-tab edits of either pref. */
export function initTheme(): void {
  applyThemePref(loadThemePref())
  applyPalettePref(loadPalettePref())
  if (typeof matchMedia === 'function') {
    matchMedia(DARK_QUERY).addEventListener('change', () => applyThemePref(loadThemePref()))
  }
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) applyThemePref(parseThemePref(e.newValue))
    if (e.key === PALETTE_STORAGE_KEY) applyPalettePref(parsePalettePref(e.newValue))
  })
}
