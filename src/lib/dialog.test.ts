import test from 'node:test'
import assert from 'node:assert/strict'
import { filesUnder, read, stripComments } from '../../tests/helpers/source.ts'
import { BOUNDED_DIALOG_BODY_CLASS, BOUNDED_DIALOG_LAYER_CLASS, BOUNDED_DIALOG_PANEL_CLASS } from './dialog.ts'

test('bounded dialog layout reserves viewport space and gives overflow to its body', () => {
  assert.match(BOUNDED_DIALOG_LAYER_CLASS, /\bpy-4\b/)
  assert.ok(BOUNDED_DIALOG_PANEL_CLASS.includes('var(--dialog-viewport-height,100dvh)-2rem'))
  assert.match(BOUNDED_DIALOG_PANEL_CLASS, /\bflex-col\b/)
  assert.match(BOUNDED_DIALOG_BODY_CLASS, /\bmin-h-0\b/)
  assert.match(BOUNDED_DIALOG_BODY_CLASS, /\boverflow-y-auto\b/)
})

test('every bounded dialog composes the whole layout and exposes the browser enumeration stamp', () => {
  const consumers = filesUnder('src').filter((file) => file.endsWith('.tsx'))
    .map((file) => ({ file, source: stripComments(read(file)) }))
    .filter(({ source }) => /BOUNDED_DIALOG_|data-bounded-dialog/.test(source))
  assert.ok(consumers.length >= 2, 'resource forms and Session-secret ceremonies remain enumerated')
  for (const { file, source } of consumers) {
    for (const symbol of ['BOUNDED_DIALOG_LAYER_CLASS', 'BOUNDED_DIALOG_PANEL_CLASS', 'BOUNDED_DIALOG_BODY_CLASS']) {
      assert.ok(source.split(symbol).length >= 3, `${file} imports and uses ${symbol}`)
    }
    assert.match(source, /data-bounded-dialog=/, `${file} is discoverable for rendered geometry checks`)
    assert.match(source, /useBoundedDialog\(dialogRef\)/, `${file} observes the available workspace below shell notices`)
  }
  for (const file of filesUnder('src').filter((file) => !file.endsWith('/lib/dialog.ts'))) {
    const source = stripComments(read(file))
    for (const literal of [BOUNDED_DIALOG_LAYER_CLASS, BOUNDED_DIALOG_PANEL_CLASS]) {
      assert.ok(!source.includes(literal), `${file} must not duplicate bounded dialog layout`)
    }
  }
})
