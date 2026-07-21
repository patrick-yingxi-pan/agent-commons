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

test('the funnel: only lib/theme.ts touches data-theme; boot calls initTheme', () => {
  const offenders = filesUnder('src', ['.ts', '.tsx'])
    .filter((f) => !f.endsWith(join('lib', 'theme.ts')))
    .filter((f) => /data-theme|dataset\.theme/.test(stripComments(read(f))))
  assert.deepEqual(offenders.map((f) => f.slice(ROOT.length + 1)), [],
    'a component stamps the theme directly — route it through src/lib/theme.ts (INV-1)')
  assert.match(stripComments(read(join(ROOT, 'src/main.tsx'))), /initTheme\(\)/,
    'main.tsx must apply the stored theme at boot (initTheme)')
})

test('Customize edits the pref through the lib (the Appearance card)', () => {
  const sectionView = stripComments(read(join(ROOT, 'src/components/SectionView.tsx')))
  assert.match(sectionView, /loadThemePref/, 'AppearanceCard must read the persisted pref')
  assert.match(sectionView, /saveThemePref/, 'AppearanceCard must persist picks through the one save funnel')
})
