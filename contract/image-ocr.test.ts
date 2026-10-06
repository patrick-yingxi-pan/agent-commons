import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  IMAGE_OCR_CAPACITY,
  IMAGE_OCR_MAX_EDGE,
  IMAGE_OCR_MAX_INPUT_BYTES,
  IMAGE_OCR_MAX_OUTPUT_BYTES,
  IMAGE_OCR_MAX_TEXT_BYTES,
  IMAGE_OCR_TIMEOUT_MS,
  isImageOcrHelperResult,
  isImageOcrResult,
  snapshotImageOcrInput,
} from './imageOcr.mjs'

function png(width = 1, height = 1) {
  const bytes = new Uint8Array(33)
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82])
  new DataView(bytes.buffer).setUint32(16, width, false)
  new DataView(bytes.buffer).setUint32(20, height, false)
  return bytes
}

test('shared OCR input policy snapshots only bounded PNG dimensions', () => {
  const source = png()
  const snapshot = snapshotImageOcrInput(source)
  assert.equal(snapshot.status, 'ready')
  if (snapshot.status === 'ready') {
    assert.notEqual(snapshot.png, source)
    source[0] = 0
    assert.equal(snapshot.png[0], 137)
  }
  assert.deepEqual(snapshotImageOcrInput(new Uint8Array(3 * 1024 * 1024 + 1)), { status: 'too-large' })
  assert.deepEqual(snapshotImageOcrInput(png(IMAGE_OCR_MAX_EDGE + 1)), { status: 'too-large' })
  assert.deepEqual(snapshotImageOcrInput(new Uint8Array(33)), { status: 'invalid' })
  assert.deepEqual(snapshotImageOcrInput(png(0)), { status: 'invalid' })
  if (typeof SharedArrayBuffer === 'function') {
    assert.deepEqual(snapshotImageOcrInput(new Uint8Array(new SharedArrayBuffer(33))), { status: 'invalid' })
  }
  assert.equal(IMAGE_OCR_MAX_INPUT_BYTES, 3 * 1024 * 1024)
})

test('shared OCR result is closed, whole, valid UTF-8 text or an exact status', () => {
  for (const status of ['no-text', 'invalid', 'too-large', 'unavailable', 'busy', 'cancelled', 'timeout']) {
    const result = { status }
    assert.equal(isImageOcrResult(result), true)
    assert.equal(isImageOcrHelperResult(result), ['no-text', 'invalid', 'too-large', 'unavailable'].includes(status))
  }
  assert.equal(isImageOcrResult({ status: 'ready', text: 'Cobalt garden 427' }), true)
  assert.equal(isImageOcrHelperResult({ status: 'ready', text: 'Cobalt garden 427' }), true)
  for (const result of [
    { status: 'ready', text: '' },
    { status: 'ready', text: '   ' },
    { status: 'ready', text: 'bad\u0000text' },
    { status: 'ready', text: '\ud800' },
    { status: 'ready', text: 'x'.repeat(IMAGE_OCR_MAX_TEXT_BYTES + 1) },
    { status: 'ready', text: 'é'.repeat(IMAGE_OCR_MAX_TEXT_BYTES / 2 + 1) },
    { status: 'ready', text: 'ok', path: '/private/image.png' },
    { status: 'failed', message: 'native detail' },
    { status: 'busy', text: 'runner status is not a helper result' },
  ]) assert.equal(isImageOcrResult(result), false)
  assert.equal(IMAGE_OCR_MAX_TEXT_BYTES, 64 * 1024)
  assert.equal(IMAGE_OCR_MAX_OUTPUT_BYTES, IMAGE_OCR_MAX_TEXT_BYTES * 6 + 128)
  assert.equal(IMAGE_OCR_TIMEOUT_MS, 30_000)
  assert.equal(IMAGE_OCR_CAPACITY, 2)
})
