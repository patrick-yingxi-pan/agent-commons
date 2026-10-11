import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  MAX_FOLDER_TREE_DEPTH,
  MAX_FOLDER_TREE_DIRECTORIES,
  MAX_FOLDER_TREE_ENTRIES,
  MAX_FOLDER_TREE_PATH_BYTES,
  isFolderTreeFiles,
  isFolderTreePath,
  snapshotFolderTreeFiles,
} from './localFolderTree.mjs'

const file = (name: string, text: string) => ({ name, sizeBytes: Buffer.byteLength(text), text })

test('tree paths are portable, relative, visible, and bounded', () => {
  assert.equal(MAX_FOLDER_TREE_DEPTH, 16)
  assert.equal(MAX_FOLDER_TREE_DIRECTORIES, 64)
  assert.equal(MAX_FOLDER_TREE_PATH_BYTES, 4096)
  assert.equal(MAX_FOLDER_TREE_ENTRIES, 500)
  assert.equal(isFolderTreePath('src/nested/file.ts'), true)
  assert.equal(isFolderTreePath('src/\u{1f600}.md'), true, 'valid astral code points are not malformed surrogates')
  for (const invalid of [
    '', '/absolute.txt', 'C:/absolute.txt', 'a\\b.txt', 'a//b.txt', './a.txt', 'a/../b.txt',
    '.env', 'src/.git/config', 'a\u0000b', 'a\u0085b', 'a\ud800b', 'a\udfff', `${'a'.repeat(256)}.txt`,
    `${Array.from({ length: MAX_FOLDER_TREE_DEPTH + 1 }, () => 'd').join('/')}/x.txt`,
    `${'é'.repeat(2049)}.txt`,
  ]) assert.equal(isFolderTreePath(invalid), false, JSON.stringify(invalid))
})

test('tree files require sorted unique visible root-relative names and shared snapshot budgets', () => {
  const files = [
    { name: 'a/one.md', sizeBytes: 3, snapshot: { text: 'one' } },
    { name: 'b/one.md', sizeBytes: 3, snapshot: { text: 'two' } },
  ]
  assert.equal(isFolderTreeFiles(files), true, 'duplicate basenames remain distinct by relative path')
  assert.equal(isFolderTreeFiles([...files].reverse()), false)
  assert.equal(isFolderTreeFiles([files[0], files[0]]), false)
  assert.equal(isFolderTreeFiles([{ ...files[0], name: 'a/.env' }]), false)
  assert.equal(isFolderTreeFiles(Array.from({ length: MAX_FOLDER_TREE_DIRECTORIES + 1 }, (_, i) => ({
    name: `d${i}/f.ts`, sizeBytes: 0, snapshot: { omitted: 'unsupported' },
  }))), false)
  assert.equal(isFolderTreeFiles(Array.from({ length: MAX_FOLDER_TREE_ENTRIES + 1 }, (_, i) => ({
    name: `d${String(i).padStart(3, '0')}/f.txt`, sizeBytes: 0, snapshot: { omitted: 'unsupported' },
  }))), false)
})

test('tree builder sorts relative paths, reads only eligible text, and preserves duplicate basenames', async () => {
  const input = [file('z/one.ts', 'z'), file('a/one.ts', 'a')]
  const reads: string[] = []
  const result = await snapshotFolderTreeFiles(input, async (entry) => {
    reads.push(entry.name)
    return Buffer.from(entry.text)
  })
  assert.deepEqual(result.map(({ name, snapshot }) => [name, snapshot]), [
    ['a/one.ts', { text: 'a' }], ['z/one.ts', { text: 'z' }],
  ])
  assert.deepEqual(reads, ['a/one.ts', 'z/one.ts'])
})

test('tree builder refuses invalid paths, duplicates, excessive depth, and too many directories before reads', async () => {
  let reads = 0
  const readBytes = async () => { reads += 1; return new Uint8Array() }
  await assert.rejects(snapshotFolderTreeFiles([file('../escape.ts', '')], readBytes), RangeError)
  await assert.rejects(snapshotFolderTreeFiles([file('a/.env', '')], readBytes), RangeError)
  await assert.rejects(snapshotFolderTreeFiles([file('a/x.ts', ''), file('a/x.ts', '')], readBytes), RangeError)
  const tooDeep = `${Array.from({ length: MAX_FOLDER_TREE_DEPTH + 1 }, () => 'd').join('/')}/x.ts`
  await assert.rejects(snapshotFolderTreeFiles([file(tooDeep, '')], readBytes), RangeError)
  const manyDirectories = Array.from({ length: MAX_FOLDER_TREE_DIRECTORIES + 1 }, (_, i) => file(`d${i}/f.ts`, ''))
  await assert.rejects(snapshotFolderTreeFiles(manyDirectories, readBytes), RangeError)
  assert.equal(reads, 0)
})

test('tree builder applies the shared 24-readable-file budget to relative paths', async () => {
  const files = Array.from({ length: 25 }, (_, index) => file(`dir/${String(index + 1).padStart(2, '0')}.ts`, 'x'))
  let reads = 0
  const result = await snapshotFolderTreeFiles(files, async () => { reads += 1; return Uint8Array.of(0x78) })
  assert.equal(reads, 24)
  assert.equal(result[23]?.snapshot.text, 'x')
  assert.deepEqual(result[24]?.snapshot, { omitted: 'budget' })
})
