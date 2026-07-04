/** ── The one model-picker funnel (form follows function) ──────────────────────
 *  Three surfaces pick a model — the composer's Model control, a routine's model
 *  picker, and Customize's "Default model" — and they must be the SAME menu:
 *  src/components/ModelPickerMenu.tsx renders the built-in Claude catalog plus the
 *  live provider registry (spec MODEL-13's "registered once, pickable everywhere").
 *  These lock the funnel: the built-in catalog renders ONLY inside the shared
 *  component (a re-hardcoded copy is how the composer's list drifted from the
 *  registry in the first place), and all three pickers consume it. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { ROOT, read, filesUnder, stripComments } from './helpers/source.ts'

test('the built-in model catalog renders only inside ModelPickerMenu', () => {
  const offenders = filesUnder('src')
    .filter((f) => !f.endsWith('ModelPickerMenu.tsx'))
    .filter((f) => /MODELS\.map\(/.test(stripComments(read(f))))
    .map((f) => f.slice(ROOT.length + 1))
  assert.deepEqual(offenders, [], 'no component re-hardcodes the model list outside the shared menu')
})

test('all three model pickers render through the shared menu', () => {
  for (const rel of ['src/components/ModelEffortControl.tsx', 'src/components/SectionView.tsx']) {
    const src = read(join(ROOT, ...rel.split('/')))
    assert.match(src, /from\s+'\.\/ModelPickerMenu'/, `${rel} imports the shared menu`)
    assert.ok(src.includes('<ModelPickerMenu'), `${rel} renders <ModelPickerMenu>`)
  }
  // SectionView carries two of the three (the routine picker + the Customize default).
  const section = read(join(ROOT, 'src', 'components', 'SectionView.tsx'))
  assert.ok((section.match(/<ModelPickerMenu/g) ?? []).length >= 2, 'SectionView renders both its pickers through it')
})

test('the shared menu reads the LIVE provider registry, not a snapshot constant', () => {
  const src = stripComments(read(join(ROOT, 'src', 'components', 'ModelPickerMenu.tsx')))
  assert.match(src, /providerModelOptions\(useProviders\(\)/, 'the registry hook feeds the list directly')
})
