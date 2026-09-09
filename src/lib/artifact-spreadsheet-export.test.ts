import assert from 'node:assert/strict'
import { test } from 'node:test'
import { artifactExportFilename, XLSX_MEDIA_TYPE, type ArtifactSpreadsheetExport } from '../../contract/index.ts'
import { decodeArtifactSpreadsheetExport } from './artifactSpreadsheetExport.ts'

const artifactId = 'artifact-sheet-1'
const zip = btoa('PK\u0003\u0004minimal workbook bytes')

function file(overrides: Partial<ArtifactSpreadsheetExport> = {}): ArtifactSpreadsheetExport {
  return {
    artifactId,
    filename: 'metrics.xlsx',
    mediaType: XLSX_MEDIA_TYPE,
    encoding: 'base64',
    content: zip,
    revision: 0,
    ...overrides,
  }
}

test('XLSX descriptor validation returns bounded binary bytes only for the exact artifact', () => {
  const decoded = decodeArtifactSpreadsheetExport(file(), artifactId)
  assert.equal(decoded.filename, 'metrics.xlsx')
  assert.equal(decoded.mediaType, XLSX_MEDIA_TYPE)
  assert.deepEqual(Array.from(decoded.content as Uint8Array), Array.from(new TextEncoder().encode('PK\u0003\u0004minimal workbook bytes')))
})

test('malformed XLSX descriptors fail before a download descriptor can be created', () => {
  const cases: Array<[string, Partial<ArtifactSpreadsheetExport>]> = [
    ['wrong identity', { artifactId: 'other' }],
    ['wrong MIME', { mediaType: 'text/plain' }],
    ['wrong encoding', { encoding: 'binary' as 'base64' }],
    ['unsafe filename', { filename: '../metrics.xlsx' }],
    ['control filename', { filename: 'metrics\n.xlsx' }],
    ['non-string filename', { filename: 42 as unknown as string }],
    ['Windows reserved filename', { filename: 'CON.xlsx' }],
    ['negative revision', { revision: -1 }],
    ['non-canonical base64', { content: 'AB==' }],
    ['non-ZIP bytes', { content: btoa('NOTZIP') }],
  ]
  for (const [label, overrides] of cases) {
    assert.throws(() => decodeArtifactSpreadsheetExport(file(overrides), artifactId), undefined, label)
  }
})

test('canonical generated filenames support dotted/unicode leaves and a large valid workbook payload', () => {
  assert.equal(artifactExportFilename('Revenue.Q1.xlsx', 'xlsx'), 'Revenue.Q1.xlsx')
  for (const source of ['Revenue.Q1.xlsx', 'Résumé — équipe', 'folder/Revenue.Q1.xlsx']) {
    const filename = artifactExportFilename(source, 'xlsx')
    assert.equal(decodeArtifactSpreadsheetExport(file({ filename }), artifactId).filename, filename)
  }
  const payload = `PK\u0003\u0004${'x'.repeat(2 * 1024 * 1024 - 4)}`
  const decoded = decodeArtifactSpreadsheetExport(file({ content: btoa(payload) }), artifactId)
  assert.equal((decoded.content as Uint8Array).byteLength, payload.length)
  assert.throws(() => decodeArtifactSpreadsheetExport(file({ content: btoa(`${payload}x`) }), artifactId), /Invalid office ZIP/)
  assert.throws(() => decodeArtifactSpreadsheetExport(file({ content: btoa(`${payload}xxxx`) }), artifactId), /Invalid office encoding/)
  assert.throws(() => decodeArtifactSpreadsheetExport(file({ content: 'AAAA ' }), artifactId), /Invalid office encoding/)
})
