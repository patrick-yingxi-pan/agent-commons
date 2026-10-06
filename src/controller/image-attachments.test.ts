import { test } from 'node:test'
import assert from 'node:assert/strict'
import { prepareUiHostFiles } from './imageAttachments.ts'
import { imageOriginal } from '../../contract/imageOriginal.ts'

const imageInput = { mimeType: 'image/png' as const, data: 'AA==', width: 1, height: 1, byteLength: 1 }
const ref = { id: 'img-' + 'a'.repeat(64), mimeType: 'image/png' as const, width: 1, height: 1, byteLength: 1 }

test('uploads image inputs serially and removes transient input after acknowledgement', async () => {
  const order: string[] = []
  const original = imageOriginal('a.svg', new Uint8Array([0, 1, 255]))
  const files = [{ id: 'a', name: 'a.svg', kind: 'photo' as const, imageInput, imageOriginal: original }, { id: 'b', name: 'b.png', kind: 'photo' as const, imageInput }]
  const prepared = await prepareUiHostFiles(files, undefined, { upload: async (image, _signal, raw) => { order.push(`${image.data}:${raw?.data ?? ''}`); return { ...ref, ...(raw ? { originalByteLength: raw.byteLength } : {}) } }, generation: () => 1 })
  assert.deepEqual(order, [`AA==:${original.data}`, 'AA==:'])
  assert.equal(prepared.every((file) => !file.imageInput && !file.imageOriginal && file.image?.id === ref.id), true)
})

test('a failed image upload can retry the same retained original bytes', async () => {
  const original = imageOriginal('source.svg', new Uint8Array([0, 255, 1, 2]))
  const files = [{ id: 'a', name: 'source.svg', kind: 'photo' as const, imageInput, imageOriginal: original }]
  const uploads: unknown[] = []
  let calls = 0
  const upload = async (snapshot: typeof imageInput, _signal?: AbortSignal, raw?: typeof original) => {
    uploads.push({ snapshot, raw })
    if (++calls === 1) throw new Error('lost acknowledgement')
    return { ...ref, originalByteLength: original.byteLength }
  }
  await assert.rejects(prepareUiHostFiles(files, undefined, { upload, generation: () => 1 }), /lost acknowledgement/)
  const prepared = await prepareUiHostFiles(files, undefined, { upload, generation: () => 1 })
  assert.deepEqual(uploads, [{ snapshot: imageInput, raw: original }, { snapshot: imageInput, raw: original }])
  assert.equal(prepared[0]?.imageOriginal, undefined)
})

test('account generation change after an upload discards the whole preparation', async () => {
  let generation = 1
  const files = [{ id: 'a', name: 'a.png', kind: 'photo' as const, imageInput }]
  const prepared = await prepareUiHostFiles(files, undefined, { upload: async () => { generation = 2; return ref }, generation: () => generation })
  assert.deepEqual(prepared, [])
})

test('account generation change during original upload discards the retained photo', async () => {
  let generation = 1
  const original = imageOriginal('a.png', new Uint8Array([1, 2, 3]))
  const files = [{ id: 'a', name: 'a.png', kind: 'photo' as const, imageInput, imageOriginal: original }]
  const prepared = await prepareUiHostFiles(files, undefined, {
    upload: async (_snapshot, _signal, raw) => { assert.deepEqual(raw, original); generation = 2; return ref },
    generation: () => generation,
  })
  assert.deepEqual(prepared, [])
})

test('abort before the next file prevents later uploads', async () => {
  const controller = new AbortController()
  let uploads = 0
  const files = [{ id: 'a', name: 'a.png', kind: 'photo' as const, imageInput }, { id: 'b', name: 'b.png', kind: 'photo' as const, imageInput }]
  const prepared = await prepareUiHostFiles(files, controller.signal, { upload: async () => { uploads++; controller.abort(); return ref }, generation: () => 1 })
  assert.deepEqual(prepared, [])
  assert.equal(uploads, 1)
})

test('mismatched upload acknowledgements never enter attachment state', async () => {
  const original = imageOriginal('source.svg', new Uint8Array([0, 1, 2]))
  const files = [{ id: 'a', name: 'source.svg', kind: 'photo' as const, imageInput, imageOriginal: original }]
  for (const acknowledgement of [ref, { ...ref, originalByteLength: 4 }, { ...ref, width: 2, originalByteLength: 3 }, { ...ref, id: 'invalid', originalByteLength: 3 }]) {
    await assert.rejects(prepareUiHostFiles(files, undefined, {
      upload: async () => acknowledgement, generation: () => 1,
    }), /did not match/)
  }
})
