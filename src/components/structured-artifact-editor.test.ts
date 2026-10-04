import assert from 'node:assert/strict'
import { test } from 'node:test'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

test('structured artifact editor is one held whole-body owner draft with structural controls', () => {
  const editor = stripComments(read(join(ROOT, 'src', 'components', 'StructuredArtifactEditor.tsx')))
  const page = stripComments(read(join(ROOT, 'src', 'components', 'artifactPreview.tsx')))
  const drafts = stripComments(read(join(ROOT, 'src', 'controller', 'artifactEditDrafts.ts')))

  assert.match(editor, /body=\{body\} onChange=\{onChange\}/, 'fields project the shared draft rather than a mount-local copy')
  assert.match(editor, /parseStructuredArtifactBody\(body\)/, 'save is gated by the shared structured parser')
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
  assert.match(drafts, /updateStructuredArtifactContent\(id, draft\.content, draft\.expectedRevision\)/, 'the opening body revision is the save precondition')
  assert.match(drafts, /onAccountSwitch\(artifactEditDrafts\.clearAll\)/, 'account switches clear every retained artifact draft')
  assert.match(page, /own && structuredDraft/, 'only the owner can render a structured editor')
  assert.match(page, /editingStructured \|\| structuredBusy/, 'download is disabled while a structured draft is open or held')
})

test('every canonical artifact body editor uses one navigation-stable account draft store', () => {
  const page = stripComments(read(join(ROOT, 'src', 'components', 'artifactPreview.tsx')))
  const drafts = stripComments(read(join(ROOT, 'src', 'controller', 'artifactEditDrafts.ts')))
  const core = stripComments(read(join(ROOT, 'src', 'controller', 'artifactEditDraftsCore.ts')))
  assert.match(page, /useArtifactEditDraft\(artifact\.id\)/)
  for (const kind of ['document', 'structured']) {
    assert.match(page, new RegExp(`artifactEditDrafts\\.start\\(artifact\\.id, \\{ kind: '${kind}'`))
  }
  assert.equal([...page.matchAll(/artifactEditDrafts\.save\(artifact\.id\)/g)].length, 2, 'both save controls use the shared lifetime')
  assert.equal([...page.matchAll(/artifactEditDrafts\.update\(artifact\.id,/g)].length, 2, 'both editors update the same projection')
  assert.match(drafts, /updateArtifactBlock\(id, draft\.block, draft\.text\)/)
  assert.match(drafts, /onAccountSwitch\(artifactEditDrafts\.clearAll\)/)
  assert.doesNotMatch(core + drafts, /localStorage|sessionStorage|indexedDB/, 'draft contents remain memory-only')
  assert.match(page, /disabled=\{edit\.index !== null\}/, 'a second block cannot replace an open or held draft')
  for (const source of [page, stripComments(read(join(ROOT, 'src', 'components', 'StructuredArtifactEditor.tsx')))]) {
    const messages = [...source.matchAll(/(?:edit\.)?error && <p className="([^"]+)" role="status"/g)]
    assert.equal(messages.length, 1, 'each editor renders its retained-draft status')
    assert.match(messages[0]![1]!, /\btext-danger-text\b/, 'small recovery copy uses the readable semantic text ramp')
  }
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
