import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DOCX_MEDIA_TYPE, artifactExportFilename, type ArtifactWordExport } from '../../contract/index.ts'
import { decodeArtifactWordExport } from './artifactWordExport.ts'

const artifactId = 'artifact-document-1'
const zip = btoa('PK\u0003\u0004minimal document bytes')

function file(overrides: Partial<ArtifactWordExport> = {}): ArtifactWordExport {
  return {
    artifactId,
    filename: 'brief.docx',
    mediaType: DOCX_MEDIA_TYPE,
    encoding: 'base64',
    content: zip,
    revision: 0,
    ...overrides,
  }
}

test('DOCX descriptor decodes through the bounded Office path', () => {
  const filename = artifactExportFilename('Brief.Q1', 'docx')
  const decoded = decodeArtifactWordExport(file({ filename }), artifactId)
  assert.equal(decoded.filename, filename)
  assert.equal(decoded.mediaType, DOCX_MEDIA_TYPE)
  assert.deepEqual(Array.from(decoded.content as Uint8Array), Array.from(new TextEncoder().encode('PK\u0003\u0004minimal document bytes')))
})

test('DOCX rejects foreign, non-DOCX, unsafe, and non-ZIP descriptors', () => {
  for (const overrides of [
    { artifactId: 'other' },
    { mediaType: 'text/plain' },
    { filename: '../brief.docx' },
    { content: btoa('NOTZIP') },
  ]) assert.throws(() => decodeArtifactWordExport(file(overrides as Partial<ArtifactWordExport>), artifactId))
})

test('DOCX rejects an encoded body over its 2 MiB bound before decoding', (t) => {
  const decoder = t.mock.method(globalThis, 'atob', () => { throw new Error('must not decode') })
  const oversized = 'A'.repeat(Math.ceil(2 * 1024 * 1024 / 3) * 4 + 4)
  assert.throws(() => decodeArtifactWordExport(file({ content: oversized }), artifactId), /Invalid office encoding/)
  assert.equal(decoder.mock.callCount(), 0)
})
