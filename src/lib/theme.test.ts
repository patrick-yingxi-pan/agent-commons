/** Locks for the composable theme recipe (INV-1). Pure parsing, registry,
 * derivation and sparse-override behavior run directly; source scans keep all
 * DOM/token writes in the single lib/theme.ts funnel. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { filesUnder, read, stripComments, ROOT } from '../../tests/helpers/source.ts'
import {
  DEFAULT_PALETTE,
  DEFAULT_THEME_PREF,
  PALETTES,
  PALETTE_TOKENS,
  THEME_AXIS_GROUPS,
  THEME_PREFS,
  deriveThemeTokens,
  effectiveThemeRecipe,
  paletteSwatch,
  parsePalettePref,
  parseThemePref,
  parseThemeSettings,
  resetThemeAxis,
  resolveTheme,
  setThemeAxis,
  themeOverrideCount,
  themeSettingsForPreset,
} from './theme.ts'

test('mode preferences are tolerant and System follows the OS', () => {
  for (const pref of THEME_PREFS) assert.equal(parseThemePref(pref), pref)
  for (const junk of [null, '', 'DARK', 'auto', '{"pref":"dark"}', 'blue']) {
    assert.equal(parseThemePref(junk), DEFAULT_THEME_PREF)
  }
  for (const systemDark of [false, true]) {
    assert.equal(resolveTheme('light', systemDark), 'light')
    assert.equal(resolveTheme('dark', systemDark), 'dark')
  }
  assert.equal(resolveTheme('system', false), 'light')
  assert.equal(resolveTheme('system', true), 'dark')
})

test('the registry carries four classics plus ten vivid recipes in one home', () => {
  assert.equal(PALETTES.length, 14)
  assert.equal(PALETTES.filter((palette) => palette.family === 'classic').length, 4)
  assert.equal(PALETTES.filter((palette) => palette.family === 'vivid').length, 10)
  assert.equal(PALETTES[0]?.id, DEFAULT_PALETTE, 'the default leads the picker')
  assert.equal(new Set(PALETTES.map((palette) => palette.id)).size, PALETTES.length, 'ids are unique')
  for (const palette of PALETTES) {
    assert.ok(palette.label && palette.blurb, `${palette.id} carries its public copy`)
    assert.match(paletteSwatch(palette), /^#[0-9a-f]{6}$/i, `${palette.id} derives a paintable swatch`)
    assert.equal(parsePalettePref(palette.id), palette.id)
  }
  for (const junk of [null, '', 'CLARET', 'blue', '{"id":"forest"}']) {
    assert.equal(parsePalettePref(junk), DEFAULT_PALETTE)
  }
})

test('orthogonal axis registry is total and every preset recipe is valid', () => {
  const axes = THEME_AXIS_GROUPS.flatMap((group) => group.axes)
  const recipeKeys = Object.keys(PALETTES[0].recipe).sort()
  assert.deepEqual(axes.map((axis) => axis.key).sort(), recipeKeys)
  assert.equal(new Set(axes.map((axis) => axis.key)).size, axes.length, 'an axis appears once')

  for (const palette of PALETTES) {
    assert.deepEqual(Object.keys(palette.recipe).sort(), recipeKeys, `${palette.id} faces every dimension`)
    for (const axis of axes) {
      const value = palette.recipe[axis.key]
      if (axis.kind === 'range') {
        assert.equal(typeof value, 'number', `${palette.id}/${axis.key} is numeric`)
        assert.ok(value >= axis.min && value <= axis.max, `${palette.id}/${axis.key} is in range`)
      } else {
        assert.ok(axis.options.some((option) => option.value === value), `${palette.id}/${axis.key} is a known choice`)
      }
    }
  }
})

test('recipe persistence is versioned, sparse, clipped and corruption-tolerant', () => {
  const fallback = themeSettingsForPreset('forest')
  assert.deepEqual(parseThemeSettings(null, 'forest'), fallback)
  assert.deepEqual(parseThemeSettings('{nope', 'forest'), fallback)
  assert.deepEqual(parseThemeSettings('{"version":2,"preset":"delft"}', 'forest'), fallback)
  assert.deepEqual(parseThemeSettings('{"version":1,"preset":"missing"}', 'forest'), fallback)

  const parsed = parseThemeSettings(JSON.stringify({
    version: 1,
    preset: 'delft',
    overrides: { groundChroma: 999, actionHue: -30, rail: 'response', unknown: 12 },
  }))
  assert.deepEqual(parsed, {
    version: 1,
    preset: 'delft',
    overrides: { groundChroma: 50, actionHue: 0, rail: 'response' },
  })
  assert.deepEqual(
    parseThemeSettings(JSON.stringify({ version: 1, preset: 'delft', overrides: { actionHue: 218 } })),
    themeSettingsForPreset('delft'),
    'preset-identical values stay sparse so future preset refinements flow through',
  )
})

test('dimensions override and reset independently', () => {
  const opal = PALETTES.find((palette) => palette.id === 'opal')!
  const base = themeSettingsForPreset('opal')
  const tuned = setThemeAxis(setThemeAxis(base, 'actionHue', 22), 'finish', 'halo')
  assert.equal(themeOverrideCount(tuned), 2)
  assert.equal(effectiveThemeRecipe(tuned).actionHue, 22)
  assert.equal(effectiveThemeRecipe(tuned).responseHue, opal.recipe.responseHue)
  const oneReset = resetThemeAxis(tuned, 'actionHue')
  assert.deepEqual(oneReset.overrides, { finish: 'halo' })
  assert.equal(effectiveThemeRecipe(oneReset).actionHue, opal.recipe.actionHue)
  assert.deepEqual(setThemeAxis(oneReset, 'finish', opal.recipe.finish).overrides, {})
})

test('every recipe derives exactly the varying token surface in both modes', () => {
  for (const palette of PALETTES) {
    for (const mode of ['light', 'dark'] as const) {
      const tokens = deriveThemeTokens(palette.recipe, mode)
      assert.deepEqual(Object.keys(tokens).sort(), [...PALETTE_TOKENS].sort(), `${palette.id}/${mode} token surface`)
      for (const token of PALETTE_TOKENS) {
        assert.match(
          tokens[token],
          /^(?:#[0-9a-f]{6}|var\(--color-(?:canvas|panel|panel-2|co-tint)\))$/i,
          `${palette.id}/${mode}/${token} is a color or an intentional rail reference`,
        )
      }
      for (const fixed of ['--color-ok', '--color-danger', '--color-added', '--color-cap-repo']) {
        assert.ok(!(fixed in tokens), `${fixed} stays semantically invariant`)
      }
    }
  }
})

test('the funnel alone stamps theme axes and writes palette tokens; boot initializes it', () => {
  const pattern = /data-theme=["']|dataset\.theme\b|data-palette=["']|dataset\.palette\b|data-theme-finish=["']|dataset\.themeFinish\b|style\.setProperty\([^\n]*--color-/
  const offenders = filesUnder('src', ['.ts', '.tsx'])
    .filter((file) => !file.endsWith(join('lib', 'theme.ts')))
    .filter((file) => pattern.test(stripComments(read(file))))
  assert.deepEqual(offenders.map((file) => file.slice(ROOT.length + 1)), [],
    'route all theme attributes and palette token writes through src/lib/theme.ts (INV-1)')
  assert.match(stripComments(read(join(ROOT, 'src/main.tsx'))), /initTheme\(\)/)
})

test('Customize derives preset and advanced controls from the shared registries', () => {
  const source = stripComments(read(join(ROOT, 'src/components/SectionView.tsx')))
  for (const name of ['loadThemePref', 'saveThemePref', 'loadThemeSettings', 'saveThemeSettings']) {
    assert.match(source, new RegExp(name), `Appearance uses ${name}`)
  }
  assert.match(source, /PALETTES\.filter/, 'preset options come from PALETTES')
  assert.match(source, /THEME_AXIS_GROUPS\.map/, 'advanced controls come from THEME_AXIS_GROUPS')
  assert.match(source, /resetThemeAxis/, 'each dimension exposes reset')
})

test('scrollbars are hover-revealed — no always-on thumb', () => {
  const css = read(join(ROOT, 'src/index.css'))
  assert.match(css, /\n\* \{\n  scrollbar-width: thin;\n  scrollbar-color: transparent transparent;\n\}/)
  assert.match(css, /\*:hover \{\n  scrollbar-color: var\(--color-line-strong\) transparent;\n\}/)
})
