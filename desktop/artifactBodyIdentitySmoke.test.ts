import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const source = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8')

test('packaged Document smoke expectations include stable IDs derived from each Artifact identity', () => {
  const direct = source('./smoke.mjs')
  assert.ok(direct.includes("import { docBlockId } from '../server/documentIdentity.ts'"))
  assert.ok(direct.includes('blocks: [{ id: docBlockId(artifact.id, 0, 0), p: artifact.body }]'))
  assert.ok(direct.includes('}, directArtifactExpectations)'))
  assert.ok(direct.includes('assert.deepEqual(reopenedDirectArtifacts.contents[id], expectedBody'))

  const attachments = source('./attachmentSmoke.mjs')
  assert.ok(attachments.includes("import { docBlockId } from '../server/documentIdentity.ts'"))
  assert.ok(attachments.includes('imported.blocks.map((p, index) => ({ id: docBlockId(saved.artifact.id, 0, index), p }))'))

  const pdf = source('./artifactPdfOcrSmoke.mjs')
  assert.ok(pdf.includes("import { docBlockId } from '../server/documentIdentity.ts'"))
  assert.ok(pdf.includes("{ id: docBlockId(artifact.id, 0, 0), p: '[Page 1] Scan Alpine 427' }"))
  assert.ok(pdf.includes("{ id: docBlockId(artifact.id, 0, 1), p: '[Page 2] Scan Bravo 813' }"))

  const image = source('./artifactImageImportSmoke.mjs')
  assert.ok(image.includes("import { docBlockId } from '../server/documentIdentity.ts'"))
  assert.ok(image.includes('{ id: docBlockId(artifact.id, 0, 0), p: CORRECTED_TEXT }'))
})
