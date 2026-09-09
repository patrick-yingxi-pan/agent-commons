import assert from 'node:assert/strict'
import { test } from 'node:test'
import { artifactExportFilename, PPTX_MEDIA_TYPE, XLSX_MEDIA_TYPE } from '../../contract/index.ts'
import { decodeArtifactPresentationExport } from './artifactPresentationExport.ts'
import { decodeArtifactOfficeExport } from './artifactOfficeExport.ts'

const artifactId = 'artifact-slides-1'
const content = btoa('PK\u0003\u0004minimal presentation')

test('PPTX descriptor shares the bounded Office validation and preserves dotted filename', () => {
  const filename = artifactExportFilename('Revenue.Q1', 'pptx')
  const decoded = decodeArtifactPresentationExport({ artifactId, filename, mediaType: PPTX_MEDIA_TYPE, encoding: 'base64', content, revision: 3 }, artifactId)
  assert.equal(decoded.filename, filename)
  assert.equal(decoded.mediaType, PPTX_MEDIA_TYPE)
  assert.deepEqual(Array.from(decoded.content as Uint8Array), Array.from(new TextEncoder().encode('PK\u0003\u0004minimal presentation')))
})

test('PPTX rejects an XLSX descriptor or foreign identity before download', () => {
  assert.throws(() => decodeArtifactPresentationExport({ artifactId, filename: 'slides.pptx', mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', encoding: 'base64', content, revision: 0 }, artifactId))
  assert.throws(() => decodeArtifactPresentationExport({ artifactId: 'other', filename: 'slides.pptx', mediaType: PPTX_MEDIA_TYPE, encoding: 'base64', content, revision: 0 }, artifactId))
})

test('PPTX accepts the exact 8 MiB ceiling and rejects one byte over it', () => {
  const payload = `PK\u0003\u0004${'x'.repeat(8 * 1024 * 1024 - 4)}`
  const valid = { artifactId, filename: 'slides.pptx', mediaType: PPTX_MEDIA_TYPE, encoding: 'base64' as const, content: btoa(payload), revision: 0 }
  assert.equal((decodeArtifactPresentationExport(valid, artifactId).content as Uint8Array).byteLength, 8 * 1024 * 1024)
  assert.throws(() => decodeArtifactPresentationExport({ ...valid, content: btoa(`${payload}x`) }, artifactId), /Invalid office ZIP/)
})

test('Office descriptors reject oversized encoded strings before allocating decoded bytes', (t) => {
  const decoder = t.mock.method(globalThis, 'atob', () => { throw new Error('must not decode') })
  for (const [format, mediaType, maxBytes] of [['xlsx', XLSX_MEDIA_TYPE, 2 * 1024 * 1024], ['pptx', PPTX_MEDIA_TYPE, 8 * 1024 * 1024]] as const) {
    const oversized = 'A'.repeat(Math.ceil(maxBytes / 3) * 4 + 4)
    assert.throws(() => decodeArtifactOfficeExport({ artifactId, filename: `slides.${format}`, mediaType, encoding: 'base64', content: oversized, revision: 0 }, artifactId, format), /Invalid office encoding/)
    assert.equal(decoder.mock.callCount(), 0, `${format} must bound allocation before Base64 decoding`)
  }
})
