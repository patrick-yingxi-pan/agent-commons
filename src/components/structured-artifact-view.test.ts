import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

test('structured artifact bodies have one shared readable renderer', () => {
  const view = stripComments(read(join(ROOT, 'src', 'components', 'StructuredArtifactView.tsx')))
  const artifact = stripComments(read(join(ROOT, 'src', 'components', 'artifactPreview.tsx')))
  const consent = stripComments(read(join(ROOT, 'src', 'components', 'RelationActionCard.tsx')))

  assert.match(view, /body\.type === 'sheet'/, 'the renderer branches on the authored body kind')
  assert.match(view, /overflow-x-auto/, 'wide sheets remain reachable inside a bounded scroll region')
  assert.match(view, /tabIndex=\{0\}/, 'the sheet scroll region is keyboard reachable')
  assert.match(view, /role="region"/, 'the sheet scroll region has a named structural landmark')
  assert.match(view, /data-structured-artifact-body="sheet"/, 'sheet bodies expose one stable rendered identity')
  assert.match(view, /data-structured-artifact-body="slides"/, 'slide bodies expose one stable rendered identity')
  assert.match(view, /whitespace-pre-wrap break-words/, 'authored line breaks and long values remain visible')
  assert.match(view, /\[overflow-wrap:anywhere\]/, 'unbroken authored tokens wrap inside their cell')
  assert.match(view, /@container max-w-full/, 'sheet columns size against their own scroll region')
  assert.match(view, /max-w-\[min\(20rem,80cqw\)\]/, 'a long cell fits inside a narrow sheet, not just the viewport')
  assert.match(view, /sheetColumnLabel\(index\)/, 'the data grid displays spreadsheet column coordinates')
  assert.match(view, /scope="row"/, 'the data grid displays row coordinates separately from authored headers')
  assert.match(view, /A1 is the first data cell beneath the column headings/, 'the coordinate header explains that headings are excluded')
  assert.match(view, /calculateWorkbook\(spreadsheetSheets\(body\)\)/, 'legacy single sheets use the same normalized workbook namespace as editing and export')
  assert.match(view, /calculateWorkbook\(body\.sheets\)/, 'named worksheets calculate together in the read projection')
  assert.match(view, /result\?\.text/, 'saved formula cells display the calculated value or error')
  assert.match(view, /aria-label=\{`Formula source/, 'formula source stays visible in the read projection')
  assert.match(view, /search\.props\(`\$\{fieldPrefix\}\.cell/, 'formula search focuses the exact visible source field')
  assert.match(view, /body\.slides\.map|shown\.map/, 'every saved slide remains represented in the full view')
  assert.match(artifact, /import \{ StructuredArtifactView \}/, 'saved artifact pages use the shared renderer')
  assert.match(artifact, /<StructuredArtifactView body=\{lib\} size=\{size\} \/>/, 'saved structured bodies are rendered by identity')
  assert.match(consent, /import \{ StructuredArtifactView \}/, 'consent previews use the same renderer')
  assert.match(consent, /preview\.structured/, 'structured proposals do not fall back to an empty text diff')
})
