import assert from 'node:assert/strict'
import { test } from 'node:test'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

test('canonical documents expose Markdown and Word through one shared download lifetime', () => {
  const page = stripComments(read(join(ROOT, 'src', 'components', 'artifactPreview.tsx')))
  assert.match(page, /useArtifactDownload\(artifact\.id, downloadFormat \?\? 'markdown'\)/)
  assert.match(page, /artifactDownload\.download\(downloadFormat\)/)
  assert.match(page, /label="Download Word"/)
  assert.match(page, /caption="Word"/)
  assert.match(page, /caption=\{downloadFormat === 'markdown' \? 'Markdown' : undefined\}/)
  assert.match(page, /artifactDownload\.download\('docx'\)/)
  assert.match(page, /downloadFormat === 'markdown'/, 'Word is offered only beside the existing document Markdown export')
})

test('both export controls share edit and operation holds', () => {
  const page = stripComments(read(join(ROOT, 'src', 'components', 'artifactPreview.tsx')))
  const disabled = 'editing !== null || saving || editingName || metadataBusy || editingStructured || structuredBusy || artifactDownload.busy'
  assert.equal(page.split(disabled).length - 1, 2, 'Markdown/Word controls must both be blocked during edits and downloads')
})
