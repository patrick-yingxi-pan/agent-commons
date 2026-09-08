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
  assert.match(view, /body\.slides\.map|shown\.map/, 'every saved slide remains represented in the full view')
  assert.match(artifact, /import \{ StructuredArtifactView \}/, 'saved artifact pages use the shared renderer')
  assert.match(artifact, /<StructuredArtifactView body=\{lib\} size=\{size\} \/>/, 'saved structured bodies are rendered by identity')
  assert.match(consent, /import \{ StructuredArtifactView \}/, 'consent previews use the same renderer')
  assert.match(consent, /preview\.structured/, 'structured proposals do not fall back to an empty text diff')
})
