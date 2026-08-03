/** ── Locks for the theme preference (INV-1, src/lib/theme.ts) ───────────────
 *  The pure pieces (parse tolerance, the pref→resolved matrix) run directly;
 *  the funnel discipline — only lib/theme.ts stamps `data-theme`, boot wires
 *  initTheme, Customize's Appearance card edits the pref through the lib — is
 *  locked by source scans (the node harness has no DOM to click). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { filesUnder, read, stripComments, ROOT } from './helpers/source.ts'
import {
  THEME_PREFS,
  DEFAULT_THEME_PREF,
  parseThemePref,
  resolveTheme,
  PALETTES,
  DEFAULT_PALETTE,
  parsePalettePref,
} from '../src/lib/theme.ts'

test('parseThemePref: known prefs round-trip, junk falls back to the default', () => {
  for (const pref of THEME_PREFS) assert.equal(parseThemePref(pref), pref)
  for (const junk of [null, '', 'DARK', 'auto', '{"pref":"dark"}', 'blue']) {
    assert.equal(parseThemePref(junk), DEFAULT_THEME_PREF)
  }
})

test('resolveTheme: explicit pick wins; system follows the OS', () => {
  for (const systemDark of [false, true]) {
    assert.equal(resolveTheme('light', systemDark), 'light')
    assert.equal(resolveTheme('dark', systemDark), 'dark')
  }
  assert.equal(resolveTheme('system', false), 'light')
  assert.equal(resolveTheme('system', true), 'dark')
})

test('parsePalettePref: known palettes round-trip, junk falls back to the default', () => {
  for (const p of PALETTES) assert.equal(parsePalettePref(p.id), p.id)
  for (const junk of [null, '', 'CLARET', 'blue', '{"id":"forest"}', 'parchment']) {
    assert.equal(parsePalettePref(junk), DEFAULT_PALETTE)
  }
})

test('the palette registry: default first, ids unique, every entry fully faced', () => {
  assert.equal(PALETTES[0]?.id, DEFAULT_PALETTE, 'the default palette leads the picker')
  assert.equal(new Set(PALETTES.map((p) => p.id)).size, PALETTES.length, 'palette ids are unique')
  for (const p of PALETTES) {
    assert.ok(p.label && p.blurb, `${p.id} carries a label and a blurb`)
    assert.match(p.swatch, /^#[0-9a-f]{6}$/i, `${p.id} carries a paintable swatch`)
  }
})

test('the funnel: only lib/theme.ts touches data-theme / data-palette; boot calls initTheme', () => {
  const offenders = filesUnder('src', ['.ts', '.tsx'])
    .filter((f) => !f.endsWith(join('lib', 'theme.ts')))
    .filter((f) => /data-theme|dataset\.theme|data-palette|dataset\.palette/.test(stripComments(read(f))))
  assert.deepEqual(offenders.map((f) => f.slice(ROOT.length + 1)), [],
    'a component stamps a theme axis directly — route it through src/lib/theme.ts (INV-1)')
  assert.match(stripComments(read(join(ROOT, 'src/main.tsx'))), /initTheme\(\)/,
    'main.tsx must apply the stored theme at boot (initTheme)')
})

test('Customize edits both prefs through the lib (the Appearance card)', () => {
  const sectionView = stripComments(read(join(ROOT, 'src/components/SectionView.tsx')))
  assert.match(sectionView, /loadThemePref/, 'AppearanceCard must read the persisted mode pref')
  assert.match(sectionView, /saveThemePref/, 'AppearanceCard must persist mode picks through the one save funnel')
  assert.match(sectionView, /loadPalettePref/, 'AppearanceCard must read the persisted palette')
  assert.match(sectionView, /savePalettePref/, 'AppearanceCard must persist palette picks through the one save funnel')
  assert.match(sectionView, /PALETTES\.map/, 'the picker derives its options from the registry, never a hand list')
})

test('scrollbars are hover-revealed — no always-on thumb (index.css)', async () => {
  const { join } = await import('node:path')
  const css = read(join(ROOT, 'src/index.css'))
  assert.match(css, /\n\* \{\n  scrollbar-width: thin;\n  scrollbar-color: transparent transparent;\n\}/,
    'at rest the thumb is transparent (the gutter keeps its space; the pill was noise)')
  assert.match(css, /\*:hover \{\n  scrollbar-color: var\(--color-line-strong\) transparent;\n\}/,
    'the pointer entering a scroll region reveals its thumb')
})
