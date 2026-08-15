/** The overlay scrim (src/lib/scrim.ts) — the dimmed backdrop behind every layer
 *  that floats over the app (the tier-driven right-panel overlay and left-rail
 *  drawer in the shell, and the centered dialogs: search palette, pickers,
 *  transient create forms). Form follows function: one styled primitive, worn by every
 *  scrim, defined once. These lock that:
 *    1. the shared class is a real full-bleed backdrop cue,
 *    2. the shell and every dialog-bearing component source it from the module,
 *    3. nothing re-hardcodes the scrim literal. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { ROOT, read, stripComments, concatSource } from '../../tests/helpers/source.ts'
import { SCRIM_CLASS } from './scrim.ts'

test('the shared scrim class is a full-bleed dimming backdrop', () => {
  for (const piece of ['absolute', 'inset-0', 'bg-black/30']) {
    assert.ok(SCRIM_CLASS.includes(piece), `keeps "${piece}"`)
  }
})

test('the app shell sources both its scrims from the shared module', () => {
  const app = read(join(ROOT, 'src', 'App.tsx'))
  assert.match(app, /from\s+'\.\/lib\/scrim'/, 'imports the shared module')
  assert.ok(
    (app.match(/SCRIM_CLASS/g) ?? []).length >= 2,
    'both shell scrims (right-panel overlay + rail drawer) wear the shared class',
  )
})

test('every dialog scrim sources the shared module', () => {
  const consumers = [
    'src/components/SearchPanel.tsx',
    'src/components/SectionView.tsx',
    'src/components/AddContextButton.tsx',
  ]
  for (const rel of consumers) {
    const src = read(join(ROOT, ...rel.split('/')))
    assert.match(src, /from\s+'(\.\.\/)+lib\/scrim'/, `${rel} imports the shared module`)
    assert.ok(src.includes('SCRIM_CLASS'), `${rel} wears the shared class`)
  }
})

test('the scrim literal is defined once — nothing re-hardcodes it', () => {
  const app = stripComments(read(join(ROOT, 'src', 'App.tsx')))
  const components = concatSource('src/components')
  for (const [name, src] of [
    ['App.tsx', app],
    ['components', components],
  ] as const) {
    assert.ok(
      !src.includes(SCRIM_CLASS),
      `${name} must take the backdrop from lib/scrim, not re-hardcode it`,
    )
  }
})
