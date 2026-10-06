import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ValidationError } from './conflict.ts'
import { ImageAssetRegistry } from './imageAssets.ts'
import type { ImageSnapshot } from '../contract/imageInput.ts'

function image(seed = 0): ImageSnapshot {
  const bytes = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'))
  if (seed) bytes[45] = (bytes[45]! + seed) & 255
  return { mimeType: 'image/png', data: Buffer.from(bytes).toString('base64'), width: 1, height: 1, byteLength: bytes.byteLength }
}

test('image assets are tenant-scoped, immutable, and content-addressed', () => {
  const registry = new ImageAssetRegistry()
  const input = image()
  const first = registry.put('tenant-a', input, 123)
  assert.match(first.id, /^img-[a-f0-9]{64}$/)
  const duplicate = registry.put('tenant-a', { ...input }, 999)
  assert.deepEqual(duplicate, first)
  assert.notEqual(registry.put('tenant-b', input).id, first.id)
  input.data = 'bad' as never
  const fetched = registry.get(first.id)
  assert.equal(fetched?.image.data, Buffer.from(Uint8Array.from(atob(first.image.data), (c) => c.charCodeAt(0))).toString('base64'))
  assert.equal(registry.snapshot().length, 2)
})

test('invalid rows and configured resource limits fail cleanly', () => {
  const registry = new ImageAssetRegistry([], { maxTenantBytes: 68, maxTotalBytes: 68, maxCount: 1 })
  registry.put('tenant-a', image())
  assert.throws(() => registry.put('tenant-a', image(1)), ValidationError)
  assert.throws(() => registry.put('', image()), ValidationError)
  assert.throws(() => new ImageAssetRegistry([{ id: 'img-bad', tenantId: 't', image: image(), createdAt: 1 }]), ValidationError)
  const row = registry.snapshot()[0]!
  assert.throws(() => new ImageAssetRegistry([{ ...row, unexpected: true } as typeof row]), ValidationError)
})

test('snapshot rehydrates and exact removal clears usage', () => {
  const source = new ImageAssetRegistry()
  const row = source.put('tenant-a', image(), 7)
  const restored = new ImageAssetRegistry(source.snapshot())
  assert.deepEqual(restored.get(row.id), row)
  assert.equal(restored.remove([row.id, 'missing']), 1)
  assert.equal(restored.get(row.id), undefined)
})

test('removing assets restores tenant, global, and count capacity without double subtraction', () => {
  const input = image()
  const registry = new ImageAssetRegistry([], {
    maxTenantBytes: input.byteLength,
    maxTotalBytes: input.byteLength,
    maxCount: 1,
  })
  const first = registry.put('tenant-a', input)
  assert.equal(registry.remove([first.id, first.id]), 1)
  const replacement = registry.put('tenant-a', image(1))
  assert.throws(() => registry.put('tenant-b', input), ValidationError)
  assert.equal(registry.remove([replacement.id]), 1)
  const otherTenant = registry.put('tenant-b', input)
  assert.deepEqual(registry.snapshot(), [otherTenant])
})

test('originals distinguish equal previews, remain immutable, and count toward both byte limits', () => {
  const preview = image()
  const original = { name: 'source.svg', data: 'PHN2Zy8+', byteLength: 6 }
  const other = { ...original, data: 'PHN2ZyA+' }
  const registry = new ImageAssetRegistry()
  const legacy = registry.put('a', preview, 1)
  const retained = registry.put('a', preview, 2, original)
  assert.notEqual(retained.id, legacy.id)
  assert.deepEqual(retained.original, original)
  assert.deepEqual(registry.put('a', preview, 99, { ...original }), retained)
  assert.notEqual(registry.put('a', preview, 2, other).id, retained.id)
  assert.deepEqual(new ImageAssetRegistry(registry.snapshot()).snapshot(), registry.snapshot())
  assert.throws(() => new ImageAssetRegistry([{ ...retained, original: other }]), ValidationError)
  retained.original!.data = 'bad'
  assert.deepEqual(registry.get(retained.id)?.original, original)
  for (const limits of [{ maxTenantBytes: preview.byteLength + 5 }, { maxTotalBytes: preview.byteLength + 5 }]) {
    assert.throws(() => new ImageAssetRegistry([], limits).put('a', preview, 1, original), ValidationError)
  }
  const limited = new ImageAssetRegistry([], { maxTotalBytes: preview.byteLength + 6 })
  const row = limited.put('a', preview, 1, original)
  assert.equal(limited.remove([row.id, row.id]), 1)
  assert.deepEqual(limited.put('b', preview, 1, original).original, original)
})
