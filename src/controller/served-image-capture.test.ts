import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServedImageCapture } from './servedImageCapture.ts'
import { refreshAccount } from '../api/account.ts'
import { imageFixture } from '../../tests/helpers/imageFixture.mjs'
import { imageOriginal } from '../../contract/imageOriginal.ts'

const id = '11111111-1111-4111-8111-111111111111'
const bytes = imageFixture(2, 2)
const image = { mimeType: 'image/png' as const, data: bytes.toString('base64'), width: 2, height: 2, byteLength: bytes.length }
const { data: _data, ...metadata } = image
const ref = { ...metadata, id: 'img-' + 'a'.repeat(64), originalByteLength: bytes.byteLength }
const oneByteRef = { ...ref, originalByteLength: 1 }

test('image capture saves bounded normalized content once and publishes only its asset receipt', async () => {
  const calls: string[] = []
  const capture = createServedImageCapture('runner:one', 'photos/a.svg', id, {
    read: async (source, path, limit) => { calls.push('read'); assert.equal(source, 'runner:one'); assert.equal(path, 'photos/a.svg'); assert.equal(limit, 8 * 1024 * 1024); return new Uint8Array([1]) },
    normalize: async () => { calls.push('normalize'); return image },
    upload: async (value, _signal, original) => { calls.push('upload'); assert.deepEqual(value, image); assert.deepEqual(original, imageOriginal('a.svg', new Uint8Array([1]))); return oneByteRef },
  })
  const saved = await capture()
  assert.deepEqual(await capture(), saved)
  assert.deepEqual(calls, ['read', 'normalize', 'upload'])
  assert.deepEqual({ ...saved, capturedAt: 'time' }, { version: 1, snapshotId: id, capturedAt: 'time', sourceId: 'runner:one', path: 'photos/a.svg', image: oneByteRef })
  assert.equal(JSON.stringify(saved).includes(image.data), false)
})

test('upload failure retries identical normalized bytes without reading or decoding the changed source', async () => {
  let reads = 0; let decodes = 0
  const uploads: unknown[] = []
  const capture = createServedImageCapture('cloud', 'a.png', id, {
    read: async () => { reads++; return new Uint8Array([reads]) },
    normalize: async () => { decodes++; return image },
    upload: async (value, _signal, original) => { uploads.push({ image: structuredClone(value), original }); if (uploads.length === 1) throw new Error('lost upload acknowledgement'); return { ...ref, originalByteLength: 1 } },
  })
  await assert.rejects(capture(), /lost upload acknowledgement/)
  const saved = await capture()
  assert.equal(reads, 1); assert.equal(decodes, 1)
  assert.deepEqual(uploads, [{ image, original: imageOriginal('a.png', new Uint8Array([1])) }, { image, original: imageOriginal('a.png', new Uint8Array([1])) }])
  assert.equal(saved.snapshotId, id)
})

test('served image retry retains and reuploads the exact original bytes with its basename', async () => {
  let reads = 0
  const uploads: unknown[] = []
  const raw = new Uint8Array([0, 255, 8, 4])
  const original = imageOriginal('a.png', raw)
  const capture = createServedImageCapture('cloud', 'photos/a.png', id, {
    read: async () => { reads++; return raw },
    normalize: async () => image,
    upload: async (normalized, _signal, retained) => {
      uploads.push({ normalized, retained })
      if (uploads.length === 1) throw new Error('lost upload acknowledgement')
      return { ...ref, originalByteLength: retained?.byteLength }
    },
  })
  await assert.rejects(capture(), /lost upload acknowledgement/)
  await capture()
  assert.equal(reads, 1)
  assert.deepEqual(uploads, [
    { normalized: image, retained: original },
    { normalized: image, retained: original },
  ])
})

test('a failed decode can retry but invalid identity never reads or uploads', async () => {
  let reads = 0; let decodes = 0; let uploads = 0
  const deps = { read: async () => { reads++; return bytes }, normalize: async () => { if (++decodes === 1) throw new Error('decode failure'); return image }, upload: async () => { uploads++; return ref } }
  const capture = createServedImageCapture('cloud', 'a.png', id, deps)
  await assert.rejects(capture(), /decode failure/)
  await capture()
  assert.deepEqual([reads, decodes, uploads], [2, 2, 1])
  for (const [source, path, receipt] of [['ui-host', 'a.png', id], ['cloud', '../a.png', id], ['cloud', 'a.png', 'bad'], ['cloud', 'a.txt', id]]) {
    await assert.rejects(createServedImageCapture(source, path, receipt, deps)(), /source is invalid/)
  }
  assert.deepEqual([reads, decodes, uploads], [2, 2, 1])
})

test('account and cancellation fences span read, decode, upload and an already prepared retry', async () => {
  for (const phase of ['read', 'decode', 'upload', 'retry']) for (const reason of ['account', 'cancel']) {
    const controller = new AbortController()
    let stage = 'read'; let uploads = 0
    const fence = () => {
      if (phase !== stage) return
      if (reason === 'account') refreshAccount({ userId: 'other', tenantId: 'other' })
      else controller.abort()
    }
    const capture = createServedImageCapture('cloud', 'a.png', id, {
      read: async () => { stage = 'read'; fence(); return bytes },
      normalize: async () => { stage = 'decode'; fence(); return image },
      upload: async () => { uploads++; stage = 'upload'; fence(); return ref },
    })
    try {
      if (phase === 'retry') { await capture(); stage = 'retry'; fence() }
      await assert.rejects(capture(controller.signal), /account changed|aborted/i)
      assert.equal(uploads, ['upload', 'retry'].includes(phase) ? 1 : 0)
    } finally { refreshAccount(null) }
  }
})

test('invalid normalization and mismatched upload metadata cannot publish a saved image', async () => {
  let uploads = 0
  await assert.rejects(createServedImageCapture('cloud', 'a.png', id, {
    read: async () => bytes, normalize: async () => ({ ...image, data: 'invalid' }), upload: async () => { uploads++; return ref },
  })(), /invalid saved copy/)
  assert.equal(uploads, 0)
  await assert.rejects(createServedImageCapture('cloud', 'a.png', id, {
    read: async () => bytes, normalize: async () => image, upload: async () => ({ ...ref, width: 3 }),
  })(), /did not match/)
})
