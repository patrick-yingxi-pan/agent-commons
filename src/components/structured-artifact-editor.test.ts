import assert from 'node:assert/strict'
import { test } from 'node:test'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

test('workbook reading and editing share an accessible identity-based tab strip and one draft', () => {
  const tabs = stripComments(read(join(ROOT, 'src', 'components', 'WorkbookTabs.tsx')))
  const view = stripComments(read(join(ROOT, 'src', 'components', 'StructuredArtifactView.tsx')))
  const editor = stripComments(read(join(ROOT, 'src', 'components', 'StructuredArtifactEditor.tsx')))
  for (const source of [view, editor]) assert.match(source, /<WorkbookTabs\b/)
  assert.match(tabs, /role="tablist" aria-label="Worksheets"/)
  assert.match(tabs, /role="tab"/)
  assert.match(tabs, /role="tabpanel"/)
  assert.match(tabs, /aria-selected=\{index === activeIndex\}/)
  assert.match(tabs, /tabIndex=\{index === activeIndex \? 0 : -1\}/)
  for (const key of ['Home', 'End', 'ArrowRight', 'ArrowLeft']) assert.ok(tabs.includes(`'${key}'`))
  assert.match(tabs, /flex-wrap/, 'all tab labels fit the pane instead of hiding beyond a strip')
  assert.match(editor, /spreadsheetSheets\(body\)/, 'legacy and named sheets use one projection')
  assert.match(editor, /Undo removal/, 'removal is reversible before saving')
  assert.match(editor, /change\(\{ type: 'workbook', sheets: next \}\)/, 'tab operations edit one complete draft')
  assert.match(editor, /const change = .*setPaste\(null\); onChange\(next\)/, 'ordinary edits invalidate paste Undo before updating the shared draft')
  assert.match(editor, /const currentPaste = reconcileSheetPasteFeedback\(paste, body\)/, 'paste feedback goes through the shared invalidation rule')
  assert.match(editor, /if \(currentPaste !== paste\) setPaste\(currentPaste\)/, 'a retired snapshot cannot reappear after an equal-body edit')
  assert.match(editor, /data-sheet-paste-feedback/, 'the browser can enumerate live paste feedback')
})

test('structured artifact editor is one held whole-body owner draft with structural controls', () => {
  const editor = stripComments(read(join(ROOT, 'src', 'components', 'StructuredArtifactEditor.tsx')))
  const page = stripComments(read(join(ROOT, 'src', 'components', 'artifactPreview.tsx')))
  const drafts = stripComments(read(join(ROOT, 'src', 'controller', 'artifactEditDrafts.ts')))

  assert.match(editor, /body=\{body\} onChange=\{onChange\}/, 'fields project the shared draft rather than a mount-local copy')
  assert.match(editor, /parseEditableArtifactBody\(body\)/, 'save is gated by the shared complete-body parser')
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

test('document editor preserves typed block identity, offers insertion/reorder/delete, and reviews literal conflict content', () => {
  const editor = stripComments(read(join(ROOT, 'src', 'components', 'DocumentArtifactEditor.tsx')))
  assert.match(editor, /parseEditableArtifactBody\(body\)/, 'complete document validation gates Save')
  assert.match(editor, /crypto\.randomUUID\(\)/, 'new blocks receive unique IDs at insertion')
  assert.match(editor, /id, h: ''/)
  assert.match(editor, /id, p: ''/)
  assert.match(editor, /id, ul: \[''\]/)
  assert.match(editor, /id, code: \[''\]/)
  assert.match(editor, /id, email: \{ to: '', subject: '' \}/)
  assert.match(editor, /Insert position/, 'typed blocks insert at a user-selected position')
  assert.match(editor, /const boundedInsertAt = Math\.min\(Math\.max\(insertAt, 0\), blocks\.length\)/,
    'a shared draft shrink clamps stale insertion positions against the latest body')
  assert.match(editor, /next\.splice\(boundedInsertAt, 0, createBlock\(kind\)\)/)
  assert.match(editor, /blockKinds = \['heading', 'paragraph', 'bullet list', 'code block', 'email header'\]/,
    'all five document block variants are insertable')
  assert.match(editor, /<Plus size=\{12\} \/> Add \{kind\}/)
  for (const label of ['Document title', 'heading', 'paragraph', 'bullet list', 'code block', 'email recipient', 'email subject']) {
    assert.ok(editor.includes(label), `document input is explicitly labeled: ${label}`)
  }
  assert.match(editor, /Move block \$\{index \+ 1\} up/)
  assert.match(editor, /Move block \$\{index \+ 1\} down/)
  assert.match(editor, /Delete block \$\{index \+ 1\}/)
  assert.match(editor, /data-doc-block-id=\{block\.id\}/)
  assert.match(editor, /discussions on deleted blocks are marked “original block deleted/i, 'draft deletion discloses the resulting discussion anchor state')
  const fields = editor.slice(editor.indexOf('function DocumentBlockEditor'), editor.indexOf('function blockLabel'))
  assert.doesNotMatch(fields, /\.ul\.join\(|\.code\.join\(|\.split\('\\n'\)/, 'editing line-array variants never remaps embedded newlines')
  assert.match(editor, /block\.ul\.map\(\(bullet, bulletIndex\)/)
  assert.match(editor, /block\.code\.map\(\(line, lineIndex\)/)
  assert.match(editor, /DocumentBodyLiteral/, 'conflicts render readable current values without importing the page preview')
  assert.doesNotMatch(editor, /artifactPreview/)
  assert.match(editor, /Save changes/)
  assert.match(editor, /Cancel/)
  assert.match(editor, /2,000 characters per text field, and 20,000 characters of block content total/)
})
