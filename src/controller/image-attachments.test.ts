import { test } from 'node:test'
import assert from 'node:assert/strict'
import { prepareUiHostFiles } from './imageAttachments.ts'

const imageInput = { mimeType: 'image/png' as const, data: 'AA==', width: 1, height: 1, byteLength: 1 }
const ref = { id: 'img-' + 'a'.repeat(64), mimeType: 'image/png' as const, width: 1, height: 1, byteLength: 1 }

test('uploads image inputs serially and removes transient input after acknowledgement', async () => {
  const order: string[] = []
  const files = [{ id: 'a', name: 'a.png', kind: 'photo' as const, imageInput }, { id: 'b', name: 'b.png', kind: 'photo' as const, imageInput }]
  const prepared = await prepareUiHostFiles(files, undefined, { upload: async (image) => { order.push(image.data); return ref }, generation: () => 1 })
  assert.deepEqual(order, ['AA==', 'AA=='])
  assert.equal(prepared.every((file) => !file.imageInput && file.image?.id === ref.id), true)
})

test('account generation change after an upload discards the whole preparation', async () => {
  let generation = 1
  const files = [{ id: 'a', name: 'a.png', kind: 'photo' as const, imageInput }]
  const prepared = await prepareUiHostFiles(files, undefined, { upload: async () => { generation = 2; return ref }, generation: () => generation })
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
