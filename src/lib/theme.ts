/** ── Theme preference + recipe funnel ───────────────────────────────────────
 *  Appearance is three orthogonal layers, all owned here:
 *    • MODE — Light / Dark / System resolves to `data-theme`.
 *    • PRESET — one of PALETTES, stamped as `data-palette`.
 *    • RECIPE OVERRIDES — sparse edits over that preset's shared dimensions.
 *
 *  A named palette is therefore a starting recipe, not a sealed CSS block.
 *  `deriveThemeTokens` turns the effective recipe into exactly
 *  PALETTE_TOKENS; `applyTheme` writes those token values inline on <html>
 *  before React renders. Semantic status, capability and diff colors never
 *  enter this varying set. The persisted shape is versioned and sparse so a
 *  preset may evolve while untouched dimensions follow it, and every edited
 *  dimension can reset independently.
 *
 *  Nothing else may stamp a theme data attribute or write palette token values
 *  — invariant INV-1, locked by theme.test.ts + spec-conformance.test.ts. */

export type ThemePref = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

export const THEME_PREFS: readonly ThemePref[] = ['light', 'dark', 'system']
export const DEFAULT_THEME_PREF: ThemePref = 'system'

const MODE_STORAGE_KEY = 'claude-ui.customize.theme'
const LEGACY_PALETTE_STORAGE_KEY = 'claude-ui.customize.palette'
const SETTINGS_STORAGE_KEY = 'claude-ui.customize.theme-recipe.v1'
const DARK_QUERY = '(prefers-color-scheme: dark)'

/* ── Orthogonal recipe dimensions ─────────────────────────────────────────── */

export const RAIL_TREATMENTS = [
  { value: 'flush', label: 'Flush' },
  { value: 'tonal', label: 'Tonal' },
  { value: 'response', label: 'Response-tinted' },
  { value: 'contrast', label: 'High contrast' },
] as const

export const OPTICAL_FINISHES = [
  { value: 'flat', label: 'Flat' },
  { value: 'duotone', label: 'Duotone focus' },
  { value: 'halo', label: 'Soft focus halo' },
  { value: 'hairline', label: 'Chromatic hairline' },
] as const

export type RailTreatment = (typeof RAIL_TREATMENTS)[number]['value']
export type OpticalFinish = (typeof OPTICAL_FINISHES)[number]['value']

export type ThemeRecipe = {
  groundHue: number
  groundChroma: number
  inkHue: number
  actionHue: number
  responseHue: number
  energy: number
  separation: number
  rail: RailTreatment
  tint: number
  finish: OpticalFinish
}

export type ThemeAxis = keyof ThemeRecipe
export type NumericThemeAxis = {
  [K in ThemeAxis]: ThemeRecipe[K] extends number ? K : never
}[ThemeAxis]
export type ChoiceThemeAxis = Exclude<ThemeAxis, NumericThemeAxis>

export type NumericAxisDefinition = {
  kind: 'range'
  key: NumericThemeAxis
  label: string
  min: number
  max: number
  step: number
  unit: string
}

export type ChoiceAxisDefinition = {
  kind: 'choice'
  key: ChoiceThemeAxis
  label: string
  options: readonly { value: string; label: string }[]
}

export type ThemeAxisDefinition = NumericAxisDefinition | ChoiceAxisDefinition

/** The Customize UI derives every advanced control from this registry. Grouping
 *  is presentation; the recipe keys are the persisted contract. */
export const THEME_AXIS_GROUPS: readonly {
  id: 'foundation' | 'voices' | 'structure' | 'finish'
  label: string
  axes: readonly ThemeAxisDefinition[]
}[] = [
  {
    id: 'foundation',
    label: 'Foundation',
    axes: [
      { kind: 'range', key: 'groundHue', label: 'Ground hue', min: 0, max: 359, step: 1, unit: '°' },
      { kind: 'range', key: 'groundChroma', label: 'Ground chroma', min: 0, max: 50, step: 1, unit: '%' },
      { kind: 'range', key: 'inkHue', label: 'Ink cast', min: 0, max: 359, step: 1, unit: '°' },
    ],
  },
  {
    id: 'voices',
    label: 'Voices',
    axes: [
      { kind: 'range', key: 'actionHue', label: 'Action hue', min: 0, max: 359, step: 1, unit: '°' },
      { kind: 'range', key: 'responseHue', label: 'Response hue', min: 0, max: 359, step: 1, unit: '°' },
      { kind: 'range', key: 'energy', label: 'Color energy', min: 35, max: 100, step: 1, unit: '%' },
    ],
  },
  {
    id: 'structure',
    label: 'Structure',
    axes: [
      { kind: 'range', key: 'separation', label: 'Surface separation', min: 0, max: 12, step: 1, unit: ' steps' },
      { kind: 'choice', key: 'rail', label: 'Rail treatment', options: RAIL_TREATMENTS },
    ],
  },
  {
    id: 'finish',
    label: 'Finish',
    axes: [
      { kind: 'range', key: 'tint', label: 'Tint weight', min: 6, max: 26, step: 1, unit: '%' },
      { kind: 'choice', key: 'finish', label: 'Optical finish', options: OPTICAL_FINISHES },
    ],
  },
]

type PalettePreset = {
  id: string
  label: string
  blurb: string
  family: 'classic' | 'vivid'
  recipe: ThemeRecipe
}

/** One home for the four established palettes and ten vivid additions. */
export const PALETTES = [
  { id: 'claret', label: 'Claret', blurb: 'Oxblood verbs and Prussian responses on rose-cast linen.', family: 'classic', recipe: { groundHue: 350, groundChroma: 16, inkHue: 345, actionHue: 354, responseHue: 212, energy: 62, separation: 7, rail: 'flush', tint: 17, finish: 'flat' } },
  { id: 'terracotta', label: 'Terracotta', blurb: 'The warm Claude classic — clay on parchment.', family: 'classic', recipe: { groundHue: 48, groundChroma: 16, inkHue: 48, actionHue: 16, responseHue: 16, energy: 65, separation: 7, rail: 'flush', tint: 17, finish: 'flat' } },
  { id: 'indigo', label: 'Indigo', blurb: 'Cool ink on porcelain — the engineer’s blueprint.', family: 'classic', recipe: { groundHue: 220, groundChroma: 16, inkHue: 230, actionHue: 234, responseHue: 234, energy: 75, separation: 7, rail: 'flush', tint: 16, finish: 'flat' } },
  { id: 'forest', label: 'Forest', blurb: 'Deep green on sage — the field notebook.', family: 'classic', recipe: { groundHue: 135, groundChroma: 15, inkHue: 130, actionHue: 145, responseHue: 145, energy: 55, separation: 7, rail: 'flush', tint: 17, finish: 'flat' } },
  { id: 'kintsugi', label: 'Kintsugi Noir', blurb: 'Lacquer, washi and molten gold with a blue-glass answer.', family: 'vivid', recipe: { groundHue: 40, groundChroma: 30, inkHue: 30, actionHue: 40, responseHue: 192, energy: 80, separation: 7, rail: 'contrast', tint: 18, finish: 'hairline' } },
  { id: 'biolume', label: 'Biolume Lagoon', blurb: 'Abyssal teal lit by cyan actions and ultraviolet responses.', family: 'vivid', recipe: { groundHue: 168, groundChroma: 35, inkHue: 182, actionHue: 176, responseHue: 258, energy: 90, separation: 7, rail: 'tonal', tint: 18, finish: 'halo' } },
  { id: 'night-bloom', label: 'Night Bloom', blurb: 'Shell pink, bougainvillea and jade with a velvet nocturne.', family: 'vivid', recipe: { groundHue: 340, groundChroma: 35, inkHue: 328, actionHue: 330, responseHue: 174, energy: 83, separation: 7, rail: 'tonal', tint: 18, finish: 'flat' } },
  { id: 'saffron', label: 'Saffron Circuit', blurb: 'Sun-warmed paper crossed by saffron and cerulean signals.', family: 'vivid', recipe: { groundHue: 45, groundChroma: 45, inkHue: 45, actionHue: 40, responseHue: 198, energy: 86, separation: 7, rail: 'tonal', tint: 16, finish: 'hairline' } },
  { id: 'ultraviolet', label: 'Ultraviolet Peach', blurb: 'Lilac fog, saturated violet and one ripe-peach countervoice.', family: 'vivid', recipe: { groundHue: 280, groundChroma: 28, inkHue: 284, actionHue: 270, responseHue: 18, energy: 78, separation: 8, rail: 'tonal', tint: 17, finish: 'duotone' } },
  { id: 'delft', label: 'Delft Coral', blurb: 'Porcelain, cobalt and a crisp vermilion response.', family: 'vivid', recipe: { groundHue: 216, groundChroma: 26, inkHue: 220, actionHue: 218, responseHue: 4, energy: 86, separation: 8, rail: 'tonal', tint: 14, finish: 'flat' } },
  { id: 'acid-plum', label: 'Acid Plum', blurb: 'Citron paper, aubergine ink and chartreuse voltage.', family: 'vivid', recipe: { groundHue: 64, groundChroma: 46, inkHue: 290, actionHue: 292, responseHue: 75, energy: 89, separation: 9, rail: 'tonal', tint: 23, finish: 'halo' } },
  { id: 'glacier', label: 'Glacier Ember', blurb: 'Blue ice and arctic cyan interrupted by live ember.', family: 'vivid', recipe: { groundHue: 193, groundChroma: 35, inkHue: 200, actionHue: 195, responseHue: 15, energy: 86, separation: 7, rail: 'tonal', tint: 15, finish: 'duotone' } },
  { id: 'opal', label: 'Mineral Opal', blurb: 'Sea glass and amethyst joined by a shifting two-tone edge.', family: 'vivid', recipe: { groundHue: 145, groundChroma: 20, inkHue: 155, actionHue: 174, responseHue: 270, energy: 75, separation: 7, rail: 'response', tint: 18, finish: 'duotone' } },
  { id: 'carbon', label: 'Carbon Laser', blurb: 'Graphite restraint cut by signal lime and electric blue.', family: 'vivid', recipe: { groundHue: 110, groundChroma: 5, inkHue: 130, actionHue: 72, responseHue: 232, energy: 96, separation: 6, rail: 'contrast', tint: 12, finish: 'halo' } },
] as const satisfies readonly PalettePreset[]

export type PaletteId = (typeof PALETTES)[number]['id']
export const DEFAULT_PALETTE: PaletteId = 'claret'

/** The exact token surface a recipe may vary. Status, diff and capability hues
 *  stay palette-invariant by their absence here. */
export const PALETTE_TOKENS = [
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
  '--color-accent-solid',
  '--color-accent-solid-strong',
  '--color-co',
  '--color-co-strong',
  '--color-co-tint',
  '--color-co-solid',
  '--color-userbubble',
] as const

export type PaletteToken = (typeof PALETTE_TOKENS)[number]
export type ThemeTokenMap = Record<PaletteToken, string>
export type ThemeOverrides = Partial<ThemeRecipe>
export type ThemeSettings = { version: 1; preset: PaletteId; overrides: ThemeOverrides }

export const THEME_RECIPE_VERSION = 1 as const

const AXIS_DEFINITIONS = THEME_AXIS_GROUPS.flatMap((group) => group.axes)
export function paletteById(id: PaletteId) {
  return PALETTES.find((palette) => palette.id === id)!
}

export function themeSettingsForPreset(preset: PaletteId): ThemeSettings {
  return { version: THEME_RECIPE_VERSION, preset, overrides: {} }
}

export function effectiveThemeRecipe(settings: ThemeSettings): ThemeRecipe {
  return { ...paletteById(settings.preset).recipe, ...settings.overrides }
}

export function themeOverrideCount(settings: ThemeSettings): number {
  return Object.keys(settings.overrides).length
}

export function setThemeAxis(settings: ThemeSettings, key: ThemeAxis, value: ThemeRecipe[ThemeAxis]): ThemeSettings {
  const overrides: ThemeOverrides = { ...settings.overrides, [key]: value }
  if (value === paletteById(settings.preset).recipe[key]) delete overrides[key]
  return { ...settings, overrides }
}

export function resetThemeAxis(settings: ThemeSettings, key: ThemeAxis): ThemeSettings {
  const overrides = { ...settings.overrides }
  delete overrides[key]
  return { ...settings, overrides }
}

export function formatThemeAxisValue(axis: ThemeAxisDefinition, value: ThemeRecipe[ThemeAxis]): string {
  if (axis.kind === 'range') return `${value}${axis.unit}`
  return axis.options.find((option) => option.value === value)?.label ?? String(value)
}

/* ── Tolerant persistence ─────────────────────────────────────────────────── */

export function parseThemePref(raw: string | null): ThemePref {
  return (THEME_PREFS as readonly string[]).includes(raw ?? '') ? (raw as ThemePref) : DEFAULT_THEME_PREF
}

export function resolveTheme(pref: ThemePref, systemDark: boolean): ResolvedTheme {
  if (pref === 'system') return systemDark ? 'dark' : 'light'
  return pref
}

export function parsePalettePref(raw: string | null): PaletteId {
  return PALETTES.some((palette) => palette.id === raw) ? (raw as PaletteId) : DEFAULT_PALETTE
}

function normalizeAxis(axis: ThemeAxisDefinition, raw: unknown): ThemeRecipe[ThemeAxis] | undefined {
  if (axis.kind === 'choice') {
    return typeof raw === 'string' && axis.options.some((option) => option.value === raw)
      ? raw as ThemeRecipe[ThemeAxis]
      : undefined
  }
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined
  const clipped = Math.min(axis.max, Math.max(axis.min, raw))
  const stepped = axis.min + Math.round((clipped - axis.min) / axis.step) * axis.step
  return stepped as ThemeRecipe[ThemeAxis]
}

/** Unknown versions/ids fall back; unknown keys are ignored; known values are
 *  clipped to their axis contract. A corrupt preference can never strand the
 *  app with invalid CSS. */
export function parseThemeSettings(raw: string | null, fallbackPreset: PaletteId = DEFAULT_PALETTE): ThemeSettings {
  if (!raw) return themeSettingsForPreset(fallbackPreset)
  try {
    const value = JSON.parse(raw) as { version?: unknown; preset?: unknown; overrides?: unknown }
    if (value.version !== THEME_RECIPE_VERSION || typeof value.preset !== 'string') {
      return themeSettingsForPreset(fallbackPreset)
    }
    const preset = parsePalettePref(value.preset)
    if (preset !== value.preset) return themeSettingsForPreset(fallbackPreset)
    const overrides: ThemeOverrides = {}
    const writableOverrides = overrides as Record<string, unknown>
    if (value.overrides && typeof value.overrides === 'object' && !Array.isArray(value.overrides)) {
      const rawOverrides = value.overrides as Record<string, unknown>
      for (const axis of AXIS_DEFINITIONS) {
        const normalized = normalizeAxis(axis, rawOverrides[axis.key])
        if (normalized === undefined || normalized === paletteById(preset).recipe[axis.key]) continue
        writableOverrides[axis.key] = normalized
      }
    }
    return { version: THEME_RECIPE_VERSION, preset, overrides }
  } catch {
    return themeSettingsForPreset(fallbackPreset)
  }
}

export function loadThemePref(): ThemePref {
  try {
    return parseThemePref(localStorage.getItem(MODE_STORAGE_KEY))
  } catch {
    return DEFAULT_THEME_PREF
  }
}

/** The legacy palette key is read only when the recipe record does not yet
 *  exist, giving existing installs a lossless one-time migration path. */
export function loadThemeSettings(): ThemeSettings {
  try {
    const current = localStorage.getItem(SETTINGS_STORAGE_KEY)
    if (current !== null) return parseThemeSettings(current)
    return themeSettingsForPreset(parsePalettePref(localStorage.getItem(LEGACY_PALETTE_STORAGE_KEY)))
  } catch {
    return themeSettingsForPreset(DEFAULT_PALETTE)
  }
}

export function saveThemePref(pref: ThemePref): void {
  try {
    localStorage.setItem(MODE_STORAGE_KEY, pref)
  } catch {
    /* ignore quota / privacy-mode errors */
  }
  applyTheme(pref, loadThemeSettings())
}

export function saveThemeSettings(settings: ThemeSettings): void {
  const normalized = parseThemeSettings(JSON.stringify(settings))
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(normalized))
  } catch {
    /* ignore quota / privacy-mode errors */
  }
  applyTheme(loadThemePref(), normalized)
}

/* ── Pure recipe → token derivation ───────────────────────────────────────── */

type Rgb = [number, number, number]

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

function hslToRgb(hue: number, saturation: number, lightness: number): Rgb {
  const h = ((hue % 360) + 360) % 360
  const s = saturation / 100
  const l = lightness / 100
  const chroma = (1 - Math.abs(2 * l - 1)) * s
  const segment = h / 60
  const x = chroma * (1 - Math.abs((segment % 2) - 1))
  let rgb: Rgb = [0, 0, 0]
  if (segment < 1) rgb = [chroma, x, 0]
  else if (segment < 2) rgb = [x, chroma, 0]
  else if (segment < 3) rgb = [0, chroma, x]
  else if (segment < 4) rgb = [0, x, chroma]
  else if (segment < 5) rgb = [x, 0, chroma]
  else rgb = [chroma, 0, x]
  const offset = l - chroma / 2
  return rgb.map((channel) => channel + offset) as Rgb
}

function rgbToHex(rgb: Rgb): string {
  return `#${rgb.map((channel) => Math.round(clamp(channel, 0, 1) * 255).toString(16).padStart(2, '0')).join('')}`
}

function color(hue: number, saturation: number, lightness: number): string {
  return rgbToHex(hslToRgb(hue, saturation, lightness))
}

function luminance(rgb: Rgb): number {
  const linear = rgb.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
}

function ratio(a: Rgb, b: Rgb): number {
  const first = luminance(a)
  const second = luminance(b)
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
}

function readableLightness(hue: number, saturation: number, backgrounds: readonly Rgb[], mode: ResolvedTheme, target: number, start?: number): number {
  let lightness = start ?? (mode === 'light' ? 38 : 70)
  const direction = mode === 'light' ? -1 : 1
  while (
    backgrounds.some((background) => ratio(hslToRgb(hue, saturation, lightness), background) < target) &&
    lightness > 8 && lightness < 94
  ) {
    lightness += direction
  }
  return lightness
}

/** The lightest same-hue seat that still carries white at 4.5:1. */
function solidLightness(hue: number, saturation: number): number {
  let lightness = 60
  const white: Rgb = [1, 1, 1]
  // Keep a small margin for the final 8-bit hex rounding: a continuous HSL
  // value exactly on 4.5 can round one channel into a 4.49 browser color.
  while (ratio(hslToRgb(hue, saturation, lightness), white) < 4.55 && lightness > 10) lightness -= 1
  return lightness
}

export function deriveThemeTokens(recipe: ThemeRecipe, mode: ResolvedTheme): ThemeTokenMap {
  const isLight = mode === 'light'
  const groundSat = recipe.groundChroma
  const canvasLightness = isLight ? 98 : 12 + groundSat * 0.04
  const panelLightness = isLight ? canvasLightness - recipe.separation * 0.38 : canvasLightness + recipe.separation * 0.72
  const panelTwoLightness = isLight ? canvasLightness - recipe.separation * 0.84 : canvasLightness + recipe.separation * 1.2
  const lineLightness = isLight ? canvasLightness - 8 - recipe.separation * 0.55 : canvasLightness + 11 + recipe.separation * 0.65
  const strongLineLightness = isLight ? lineLightness - 7 : lineLightness + 7
  const tintSaturation = clamp(recipe.energy * 0.48, 20, 48)
  const tintLightness = isLight ? 100 - recipe.tint * 0.56 : canvasLightness + recipe.tint * 0.62

  const canvasRgb = hslToRgb(recipe.groundHue, groundSat, canvasLightness)
  const panelRgb = hslToRgb(recipe.groundHue, clamp(groundSat * 0.75, 0, 44), panelLightness)
  const panelTwoRgb = hslToRgb(recipe.groundHue, clamp(groundSat * 0.8, 0, 46), panelTwoLightness)
  const neutralTextBackgrounds = [canvasRgb, panelRgb, panelTwoRgb]
  const inkSaturation = clamp(8 + groundSat * 0.12, 8, 16)
  const faintInkSaturation = clamp(6 + groundSat * 0.1, 6, 14)
  // Soft and faint are hierarchy seats, not permission to become unreadable.
  // Derive both against every neutral surface: customization can widen the
  // panel separation far beyond any named preset, especially in dark mode.
  const inkSoftLightness = readableLightness(
    recipe.inkHue,
    inkSaturation,
    neutralTextBackgrounds,
    mode,
    5.6,
    isLight ? 36 : 70,
  )
  const inkFaintLightness = readableLightness(
    recipe.inkHue,
    faintInkSaturation,
    neutralTextBackgrounds,
    mode,
    4.6,
    isLight ? 58 : 52,
  )
  const accentTintRgb = hslToRgb(recipe.actionHue, tintSaturation, tintLightness)
  const responseTintRgb = hslToRgb(recipe.responseHue, tintSaturation, tintLightness)
  const accentLightness = readableLightness(recipe.actionHue, recipe.energy, [canvasRgb], mode, 3)
  const responseLightness = readableLightness(recipe.responseHue, recipe.energy, [canvasRgb], mode, 3)
  const accentStrongLightness = readableLightness(recipe.actionHue, recipe.energy, [canvasRgb, accentTintRgb], mode, 4.5, isLight ? accentLightness - 4 : accentLightness + 6)
  const responseStrongLightness = readableLightness(recipe.responseHue, recipe.energy, [canvasRgb, responseTintRgb], mode, 4.5, isLight ? responseLightness - 4 : responseLightness + 6)
  const accentSolidLightness = solidLightness(recipe.actionHue, recipe.energy)
  const responseSolidLightness = solidLightness(recipe.responseHue, recipe.energy)

  const canvas = color(recipe.groundHue, groundSat, canvasLightness)
  const panel = rgbToHex(panelRgb)
  const panelTwo = rgbToHex(panelTwoRgb)
  const accentTint = rgbToHex(accentTintRgb)
  const responseTint = rgbToHex(responseTintRgb)
  const sidebar = recipe.rail === 'flush'
    ? 'var(--color-canvas)'
    : recipe.rail === 'tonal'
      ? 'var(--color-panel)'
      : recipe.rail === 'response'
        ? 'var(--color-co-tint)'
        : 'var(--color-panel-2)'

  return {
    '--color-canvas': canvas,
    '--color-sidebar': sidebar,
    '--color-surface': canvas,
    '--color-panel': panel,
    '--color-panel-2': panelTwo,
    '--color-ink': color(recipe.inkHue, clamp(8 + groundSat * 0.22, 8, 20), isLight ? 15 : 92),
    '--color-ink-soft': color(recipe.inkHue, inkSaturation, inkSoftLightness),
    '--color-ink-faint': color(recipe.inkHue, faintInkSaturation, inkFaintLightness),
    '--color-line': color(recipe.groundHue, clamp(groundSat * 0.55, 8, 30), lineLightness),
    '--color-line-strong': color(recipe.groundHue, clamp(groundSat * 0.62, 10, 34), strongLineLightness),
    '--color-accent': color(recipe.actionHue, recipe.energy, accentLightness),
    '--color-accent-strong': color(recipe.actionHue, recipe.energy, accentStrongLightness),
    '--color-accent-tint': accentTint,
    '--color-accent-solid': color(recipe.actionHue, recipe.energy, accentSolidLightness),
    '--color-accent-solid-strong': color(recipe.actionHue, recipe.energy, Math.max(10, accentSolidLightness - 6)),
    '--color-co': color(recipe.responseHue, recipe.energy, responseLightness),
    '--color-co-strong': color(recipe.responseHue, recipe.energy, responseStrongLightness),
    '--color-co-tint': responseTint,
    '--color-co-solid': color(recipe.responseHue, recipe.energy, responseSolidLightness),
    '--color-userbubble': color(recipe.responseHue, clamp(tintSaturation * 0.72, 14, 34), clamp(tintLightness + (isLight ? 1.5 : 0), 0, 100)),
  }
}

export function paletteSwatch(palette: (typeof PALETTES)[number]): string {
  return deriveThemeTokens(palette.recipe, 'light')['--color-accent']
}

/* ── The one DOM apply funnel ─────────────────────────────────────────────── */

function systemPrefersDark(): boolean {
  return typeof matchMedia === 'function' && matchMedia(DARK_QUERY).matches
}

function applyTheme(pref: ThemePref, settings: ThemeSettings): void {
  const resolved = resolveTheme(pref, systemPrefersDark())
  const recipe = effectiveThemeRecipe(settings)
  const root = document.documentElement
  root.dataset.theme = resolved
  root.dataset.palette = settings.preset
  root.dataset.themeFinish = recipe.finish
  const tokens = deriveThemeTokens(recipe, resolved)
  for (const token of PALETTE_TOKENS) root.style.setProperty(token, tokens[token])
}

/** Boot-time wiring: apply stored state before React renders, then re-resolve on
 *  OS-mode or cross-tab changes. */
export function initTheme(): void {
  applyTheme(loadThemePref(), loadThemeSettings())
  if (typeof matchMedia === 'function') {
    matchMedia(DARK_QUERY).addEventListener('change', () => applyTheme(loadThemePref(), loadThemeSettings()))
  }
  window.addEventListener('storage', (event) => {
    if ([MODE_STORAGE_KEY, SETTINGS_STORAGE_KEY, LEGACY_PALETTE_STORAGE_KEY].includes(event.key ?? '')) {
      applyTheme(loadThemePref(), loadThemeSettings())
    }
  })
}
