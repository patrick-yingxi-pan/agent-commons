import assert from 'node:assert/strict'
import { test } from 'node:test'
import { imageOriginal } from '../../contract/imageOriginal.ts'
import { decodeImageOriginalDownload, matchesImageOriginalInfo, IMAGE_ORIGINAL_PRIVACY_COPY } from './imageOriginalDownload.ts'
import { readFileSync } from 'node:fs'

const ref = { id: `img-${'a'.repeat(64)}`, mimeType: 'image/png' as const, width: 1, height: 1, byteLength: 1, originalByteLength: 5 }
const bytes = new Uint8Array([0, 1, 127, 128, 255])
const original = imageOriginal('source.svg', bytes)

test('original-download reload evidence reads fresh metadata after the new document is writable', () => {
  const spec = readFileSync(new URL('../../e2e/image-original.spec.ts', import.meta.url), 'utf8')
  const start = spec.indexOf("test('owners download exact local SVG")
  const end = spec.indexOf('  const legacyBytes = imageFixture()', start)
  assert.ok(start >= 0 && end > start, 'the local-container reload journey exists')
  const journey = spec.slice(start, end)
  assert.doesNotMatch(journey, /waitForResponse/, 'an old-document response cannot satisfy reload readiness')
  assert.match(journey, /await page\.reload\(\)[\s\S]*?getByRole\('textbox', \{ name: 'Message', exact: true \}\)\)\.toBeEnabled\(\)[\s\S]*?const reloadedSession = await page\.request\.get\(/,
    'the new rendered composer becomes writable before a fresh request-context metadata read')
  assert.match(journey, /await downloadAndCompare\(page, reloaded, image\)/,
    'fresh metadata does not replace the actual restored-preview byte comparison')
})

test('original privacy disclosure distinguishes attached input from explicit private download on every image surface', () => {
  assert.match(IMAGE_ORIGINAL_PRIVACY_COPY, /Shared views and conversation image input use the preview copy/)
  assert.match(IMAGE_ORIGINAL_PRIVACY_COPY, /Original downloads, including MCP, stay private to the owning account/)
  const component = readFileSync(new URL('../components/ImageOriginalDownload.tsx', import.meta.url), 'utf8')
  assert.match(component, /: IMAGE_ORIGINAL_PRIVACY_COPY/)
  assert.doesNotMatch(component, /text-danger-strong/, 'image recovery copy uses the readable text seat, not the status accent')
  assert.equal((component.match(/text-danger-text/g) ?? []).length, 2, 'availability and body failures use the same readable error token')
  const panel = readFileSync(new URL('../components/AttachmentPanel.tsx', import.meta.url), 'utf8')
  assert.equal((panel.match(/<ImageOriginalDownload /g) ?? []).length, 2, 'Files and Photos share one disclosure')
  const intake = readFileSync(new URL('../components/ServedFileIntake.tsx', import.meta.url), 'utf8')
  assert.match(intake, /IMAGE_ORIGINAL_PRIVACY_COPY/, 'served intake uses the same original privacy policy as its preview')
  assert.doesNotMatch(intake, /originals are not retained/, 'intake must not contradict retained-source behavior')
})

test('original containers download exact bytes with their filename but never an inline image MIME', () => {
  assert.deepEqual(decodeImageOriginalDownload({ id: ref.id, original }, ref), {
    filename: 'source.svg', mediaType: 'application/octet-stream', content: bytes,
  })
})

test('original download rejects wrong identity, length, unsafe names, malformed bytes and extra fields', () => {
  for (const invalid of [null, [], { id: 'other', original }, { id: ref.id, original, extra: true },
    { id: ref.id, original: { ...original, byteLength: 4 } },
    { id: ref.id, original: { ...original, name: '../source.svg' } },
    { id: ref.id, original: { ...original, data: 'not base64' } }]) {
    assert.throws(() => decodeImageOriginalDownload(invalid, ref))
  }
  assert.throws(() => decodeImageOriginalDownload({ id: ref.id, original }, { ...ref, originalByteLength: 4 }))
  assert.throws(() => decodeImageOriginalDownload({ id: ref.id, original }, { ...ref, originalByteLength: undefined }))
})

test('original availability admits only matching private metadata, never raw data or another reference', () => {
  const info = { id: ref.id, name: original.name, byteLength: original.byteLength }
  assert.equal(matchesImageOriginalInfo(info, ref), true)
  for (const invalid of [null, [], { ...info, id: 'other' }, { ...info, byteLength: 4 }, { ...info, data: original.data },
    { ...info, name: '' }, { ...info, name: '../source.svg' }, { ...info, name: '.' }]) {
    assert.equal(matchesImageOriginalInfo(invalid, ref), false)
  }
  assert.equal(matchesImageOriginalInfo(info, { ...ref, originalByteLength: undefined }), false)
})
