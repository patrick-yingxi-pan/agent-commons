import test from 'node:test'
import assert from 'node:assert/strict'
import { MAX_AUTHORED_DOCUMENT_SOURCE_CHARS } from '../../contract/content.ts'
import type { ImageOcrResult } from '../../contract/imageOcr.mjs'
import { imageFixture } from '../../tests/helpers/imageFixture.mjs'
import { reviewArtifactImageImport } from './artifactImageImport.ts'

const png = imageFixture(160, 80)
const file = {
  name: 'image.notes.png', kind: 'photo' as const,
  imageInput: { mimeType: 'image/png' as const, width: 160, height: 80, byteLength: png.length, data: png.toString('base64') },
  imageOriginal: { name: 'private-original.jpg', data: 'never-supplied' },
}

test('image recognition returns only explicitly adoptable complete text, not original bytes or a saved artifact', async () => {
  const signal = new AbortController().signal
  let calls = 0
  const result = await reviewArtifactImageImport([file], signal, async (bytes, seenSignal) => {
    calls++
    assert.deepEqual(Buffer.from(bytes), png)
    assert.equal(seenSignal, signal)
    return { status: 'ready', text: '  Cobalt garden 427\nSecond line.  ' }
  })
  assert.equal(calls, 1)
  assert.equal(result.status, 'ready')
  if (result.status !== 'ready') return
  assert.equal(result.name, 'image.notes.md')
  assert.equal(result.text, '  Cobalt garden 427\nSecond line.  ')
  assert.match(result.disclosure!, /recognition errors/)
  assert.match(result.disclosure!, /not uploaded or saved/)
  assert.deepEqual(Object.keys(result).sort(), ['disclosure', 'name', 'status', 'text'])
})

test('cancelled, unsupported, multiple and invalid selections never start OCR', async () => {
  const never = async (): Promise<ImageOcrResult> => { assert.fail('must refuse before native recognition') }
  const signal = new AbortController().signal
  assert.deepEqual(await reviewArtifactImageImport([], signal, never), { status: 'cancelled' })
  assert.deepEqual(await reviewArtifactImageImport([file], AbortSignal.abort(), never), { status: 'cancelled' })
  for (const files of [[file, file], [{ ...file, kind: 'file' as const }], [{ ...file, imageInput: undefined }],
    [{ ...file, imageInput: { ...file.imageInput, byteLength: png.length + 1 } }]]) {
    const result = await reviewArtifactImageImport(files, signal, never)
    assert.equal(result.status, 'error')
  }
})

test('every closed native refusal preserves a draft and gives actionable, non-diagnostic copy', async () => {
  for (const status of ['no-text', 'invalid', 'too-large', 'unavailable', 'busy', 'timeout'] as const) {
    const result = await reviewArtifactImageImport([file], new AbortController().signal, async () => ({ status }))
    assert.equal(result.status, 'error', status)
    if (result.status === 'error') assert.match(result.message, /Your draft is unchanged\./)
  }
  assert.deepEqual(await reviewArtifactImageImport([file], new AbortController().signal, async () => ({ status: 'cancelled' })), { status: 'cancelled' })
})

test('admission never truncates over-limit text and cancellation fences late native replies', async () => {
  const text = 'x'.repeat(MAX_AUTHORED_DOCUMENT_SOURCE_CHARS)
  assert.equal((await reviewArtifactImageImport([file], new AbortController().signal, async () => ({ status: 'ready', text }))).status, 'ready')
  const oversized = await reviewArtifactImageImport([file], new AbortController().signal, async () => ({ status: 'ready', text: text + 'x' }))
  assert.equal(oversized.status, 'error')
  if (oversized.status === 'error') assert.match(oversized.message, /Nothing was truncated/)
  const controller = new AbortController()
  let complete!: (value: ImageOcrResult) => void
  const pending = reviewArtifactImageImport([file], controller.signal, () => new Promise(resolve => { complete = resolve }))
  controller.abort()
  complete({ status: 'ready', text: 'late private text' })
  assert.deepEqual(await pending, { status: 'cancelled' })
})
