import assert from 'node:assert/strict'
import { test } from 'node:test'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

test('structured artifact editor is one held whole-body owner draft with structural controls', () => {
  const editor = stripComments(read(join(ROOT, 'src', 'components', 'StructuredArtifactEditor.tsx')))
  const page = stripComments(read(join(ROOT, 'src', 'components', 'artifactPreview.tsx')))

  assert.match(editor, /structuredClone\(body\)/, 'editing starts from an exact body snapshot')
  assert.match(editor, /parseStructuredArtifactBody\(draft\)/, 'save is gated by the shared structured parser')
  assert.match(editor, /Save changes/, 'the full draft has one explicit save')
  assert.match(editor, /Cancel/, 'the full draft has one explicit cancel')
  assert.match(editor, /Add column|Remove column/, 'sheets expose structural column edits')
  assert.match(editor, /Add row|Remove sheet row/, 'sheets expose structural row edits')
  assert.match(editor, /Add slide|Remove slide/, 'slides expose structural slide edits')
  assert.match(editor, /Add bullet|Remove slide .* bullet/, 'slides expose structural bullet edits')
  assert.match(editor, /Move slide .* up|Move slide .* down/, 'slides can reorder their structural units')
  assert.match(editor, /aria-label=\{`Sheet row/, 'sheet cells have unique accessible labels')
  assert.match(editor, /aria-label=\{`Slide .* title/, 'slide titles have unique accessible labels')
  assert.match(page, /<StructuredArtifactEditor/, 'the canonical artifact page mounts the editor')
  assert.match(page, /updateStructuredArtifactContent\(artifact\.id, next, structuredBaseRevision\)/, 'the opening body revision is the save precondition')
  assert.match(page, /onAccountSwitch\(\(\) => setEditingStructured\(false\)\)/, 'account switches clear a retained structured draft')
  assert.match(page, /own && editingStructured/, 'only the owner can retain or render a structured editor')
  assert.match(page, /editingStructured \|\| structuredBusy/, 'download is disabled while a structured draft is open or held')
})

test('every structured add action uses the shared inline glyph-and-label layout', () => {
  const editor = stripComments(read(join(ROOT, 'src', 'components', 'StructuredArtifactEditor.tsx')))
  assert.match(editor, /const buttonClass = INLINE_ACTION_CLASS/)
  const plusActions = [...editor.matchAll(/<button\b(?:(?!<\/button>)[\s\S])*?<\/button>/g)]
    .map(([button]) => button).filter((button) => /<Plus\b/.test(button))
  assert.ok(plusActions.length >= 4, 'the editor exposes all current structural add actions')
  for (const button of plusActions) {
    assert.match(button, /className=\{buttonClass\}/, 'no structural add action hand-rolls icon/text layout')
    assert.match(button, /data-inline-action/, 'the browser can enumerate the same controls')
  }
})
