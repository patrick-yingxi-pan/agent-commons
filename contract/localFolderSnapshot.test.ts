import assert from 'node:assert/strict'
import { test } from 'node:test'
import { snapshotFolderFiles } from './localFolderSnapshot.mjs'

const file = (name: string, text: string, sizeBytes = Buffer.byteLength(text)) => ({ name, sizeBytes, text })

test('folder snapshots sort, omit dotfiles, decode whole text, and preserve exact bodies', async () => {
  const input = [file('z.ts', 'z\r\n'), file('.env', 'secret=1'), file('a.py', '\ufeffa\n'), file('photo.png', 'bytes')]
  const reads: string[] = []
  const result = await snapshotFolderFiles(input, async (entry: typeof input[number]) => { reads.push(entry.name); return Buffer.from(entry.text) })
  assert.deepEqual(result, [
    { name: 'a.py', sizeBytes: 5, snapshot: { text: '\ufeffa\n' } },
    { name: 'photo.png', sizeBytes: 5, snapshot: { omitted: 'unsupported' } },
    { name: 'z.ts', sizeBytes: 3, snapshot: { text: 'z\r\n' } },
  ])
  assert.deepEqual(reads, ['a.py', 'z.ts'])
})

test('folder snapshots never read oversized or budget-exhausted files and cap readable snapshots', async () => {
  const input = [file('01.ts', 'a'), file('02.ts', 'b'), file('03.ts', 'c'), file('04.ts', 'd')]
  const reads: string[] = []
  const result = await snapshotFolderFiles(input, async (entry: typeof input[number]) => { reads.push(entry.name); return Buffer.from(entry.text) })
  assert.equal(result.length, 4)
  assert.deepEqual(reads, ['01.ts', '02.ts', '03.ts', '04.ts'])

  const oversized = await snapshotFolderFiles([file('large.ts', 'x', 64 * 1024 + 1)], async () => { throw new Error('must not read') })
  assert.deepEqual(oversized[0].snapshot, { omitted: 'too-large' })
})

test('folder snapshots read exactly 24 eligible files and mark the 25th as budget', async () => {
  const files = Array.from({ length: 25 }, (_, index) => ({ name: `${String(index + 1).padStart(2, '0')}.ts`, sizeBytes: 1 }))
  const reads: string[] = []
  const result = await snapshotFolderFiles(files, async (entry) => { reads.push(entry.name); return Uint8Array.from([0x78]) })
  assert.equal(reads.length, 24)
  assert.equal(result[23].snapshot.text, 'x')
  assert.deepEqual(result[24].snapshot, { omitted: 'budget' })
})

test('folder snapshots classify changed-size reads safely and accept the exact 64 KiB boundary', async () => {
  const exact = Buffer.from('x'.repeat(64 * 1024))
  const result = await snapshotFolderFiles([
    { name: 'exact.ts', sizeBytes: exact.byteLength },
    { name: 'growing.ts', sizeBytes: 1 },
    { name: 'shrunk.ts', sizeBytes: 2 },
  ], async (entry) => {
    if (entry.name === 'exact.ts') return exact
    if (entry.name === 'growing.ts') return Buffer.alloc(64 * 1024 + 1, 0x78)
    return Uint8Array.from([0x78])
  })
  assert.equal(result[0].snapshot.text?.length, 64 * 1024)
  assert.deepEqual(result[1].snapshot, { omitted: 'too-large' })
  assert.deepEqual(result[2].snapshot, { omitted: 'unreadable' })
})

test('folder snapshots classify invalid, binary, unreadable, and selection-budget files', async () => {
  const files = [file('bad.ts', 'bad', 2), file('binary.ts', 'bin', 3), file('broken.ts', 'x'), file('first.ts', 'x', 64 * 1024), file('second.ts', 'x', 64 * 1024), file('zz-budget.ts', 'x', 1)]
  const bytes = new Map([
    ['bad.ts', Uint8Array.from([0xc3, 0x28])],
    ['binary.ts', Uint8Array.from([0x61, 0, 0x62])],
    ['first.ts', Buffer.from('x'.repeat(64 * 1024))],
    ['second.ts', Buffer.from('x'.repeat(64 * 1024))],
    ['zz-budget.ts', Uint8Array.from([0x78])],
    ['broken.ts', Uint8Array.from([0x78])],
  ])
  const result = await snapshotFolderFiles(files, async (entry: typeof files[number]) => {
    if (entry.name === 'broken.ts') throw new Error('gone')
    return bytes.get(entry.name)!
  })
  assert.deepEqual(result.slice(0, 2).map((entry) => [entry.name, entry.snapshot]), [
    ['bad.ts', { omitted: 'unreadable' }],
    ['binary.ts', { omitted: 'unreadable' }],
  ])
  assert.deepEqual(result.find((entry) => entry.name === 'zz-budget.ts')?.snapshot, { omitted: 'budget' })
  assert.equal(result.find((entry) => entry.name === 'first.ts')?.snapshot.text, 'x'.repeat(64 * 1024))
  assert.equal(result.find((entry) => entry.name === 'second.ts')?.snapshot.text, 'x'.repeat(64 * 1024))
  assert.deepEqual(result.find((entry) => entry.name === 'broken.ts')?.snapshot, { omitted: 'unreadable' })
})

test('folder snapshots cap total entries at 500 before reads', async () => {
  const files = Array.from({ length: 501 }, (_, index) => ({ name: `${String(index).padStart(3, '0')}.txt`, sizeBytes: 1 }))
  let reads = 0
  await assert.rejects(snapshotFolderFiles(files, async () => { reads += 1; return Uint8Array.from([0x78]) }), RangeError)
  assert.equal(reads, 0)
})
