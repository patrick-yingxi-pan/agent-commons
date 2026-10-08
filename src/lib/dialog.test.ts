import test from 'node:test'
import assert from 'node:assert/strict'
import { filesUnder, read, stripComments } from '../../tests/helpers/source.ts'
import { BOUNDED_DIALOG_BODY_CLASS, BOUNDED_DIALOG_LAYER_CLASS, BOUNDED_DIALOG_PANEL_CLASS, dialogReadRegionProps } from './dialog.ts'

test('prose-only dialog bodies share named keyboard-scroll access', () => {
  assert.deepEqual(dialogReadRegionProps('Download details'), {
    'data-dialog-read-region': true, role: 'region', 'aria-label': 'Download details', tabIndex: 0,
  })
  const consumers = filesUnder('src').filter(file => file.endsWith('.tsx'))
    .map(file => ({ file, source: stripComments(read(file)) }))
    .filter(({ source }) => /dialogReadRegionProps|data-dialog-read-region/.test(source))
  assert.ok(consumers.some(({ file }) => file.endsWith('/ConversationDownload.tsx')))
  for (const { file, source } of consumers) {
    assert.match(source, /\{\.\.\.dialogReadRegionProps\('/, file)
    assert.doesNotMatch(source, /data-dialog-read-region=/, `${file} uses the shared accessibility props`)
  }
})

test('bounded dialog layout reserves viewport space and gives overflow to its body', () => {
  assert.match(BOUNDED_DIALOG_LAYER_CLASS, /\bpy-4\b/)
  assert.ok(BOUNDED_DIALOG_PANEL_CLASS.includes('var(--dialog-viewport-height,100dvh)-2rem'))
  assert.match(BOUNDED_DIALOG_PANEL_CLASS, /\bflex-col\b/)
  assert.match(BOUNDED_DIALOG_BODY_CLASS, /\bmin-h-0\b/)
  assert.match(BOUNDED_DIALOG_BODY_CLASS, /\boverflow-y-auto\b/)
})

test('resource-form field spacing belongs to the real fieldset, not a display-contents wrapper', () => {
  const source = stripComments(read('src/components/FormDialog.tsx'))
  assert.ok(source.includes('data-form-fields className={FORM_DIALOG_FIELDS_CLASS}'), 'shared FormDialog fields use the spacing funnel on a rendered box')
  const primitive = stripComments(read('src/lib/dialog.ts'))
  assert.ok(primitive.includes("FORM_DIALOG_FIELDS_CLASS = 'min-w-0 space-y-4'"), 'one real group owns the inter-field rhythm')
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
