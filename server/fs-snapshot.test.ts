/** Whole-file, strict text snapshots use the same confined, version-checked
 * descriptor as ordinary filesystem reads, with a smaller fixed budget. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { appendFileSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fsReader } from './fs.ts'

const MAX_SNAPSHOT_BYTES = 64 * 1024

function fixture(t: { after: (cleanup: () => void) => void }) {
  const root = mkdtempSync(join(tmpdir(), 'agent-commons-fs-snapshot-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return { root, reader: fsReader(root) }
}

function restoreBuiltinMocks(t: { after: (cleanup: () => void) => void; mock: { restoreAll: () => void } }) {
  t.after(() => {
    t.mock.restoreAll()
    syncBuiltinESMExports()
  })
}

test('readSnapshot returns exact supported UTF-8 text and preserves BOM and line endings', (t) => {
  const { root, reader } = fixture(t)
  const source = '\uFEFFHéllo\r\n世界\n'
  writeFileSync(join(root, 'notes.md'), Buffer.from(source, 'utf8'))

  assert.deepEqual(reader.readSnapshot('notes.md'), { name: 'notes.md', text: source })
})

test('readSnapshot accepts empty files and exactly 64 KiB, but refuses one byte over', (t) => {
  const { root, reader } = fixture(t)
  const exact = 'é'.repeat(MAX_SNAPSHOT_BYTES / 2)
  writeFileSync(join(root, 'empty.txt'), Buffer.alloc(0))
  writeFileSync(join(root, 'exact.txt'), Buffer.from(exact, 'utf8'))
  writeFileSync(join(root, 'over.txt'), Buffer.alloc(MAX_SNAPSHOT_BYTES + 1, 0x61))

  assert.deepEqual(reader.readSnapshot('empty.txt'), { name: 'empty.txt', text: '' })
  assert.deepEqual(reader.readSnapshot('exact.txt'), { name: 'exact.txt', text: exact })
  assert.equal(reader.readSnapshot('over.txt'), undefined)
})

test('readSnapshot strictly omits invalid UTF-8, binary controls, and unsupported names', (t) => {
  const { root, reader } = fixture(t)
  writeFileSync(join(root, 'invalid.md'), Buffer.from([0xc3, 0x28]))
  writeFileSync(join(root, 'binary.txt'), Buffer.from('before\0after'))
  writeFileSync(join(root, 'archive.zip'), 'not text')
  writeFileSync(join(root, 'image.svg'), '<svg/>')

  for (const path of ['invalid.md', 'binary.txt', 'archive.zip', 'image.svg']) {
    assert.equal(reader.readSnapshot(path), undefined, path)
  }
})

test('readSnapshot rejects aliases, hidden paths, symlinks, and directories', (t) => {
  const { root, reader } = fixture(t)
  mkdirSync(join(root, 'folder'))
  writeFileSync(join(root, 'folder', 'inside.md'), 'inside')
  writeFileSync(join(root, 'outside.md'), 'outside')
  fs.symlinkSync(join(root, 'outside.md'), join(root, 'linked.md'))

  for (const path of ['../outside.md', 'folder/../outside.md', '.hidden.md', 'linked.md', 'folder']) {
    assert.equal(reader.readSnapshot(path), undefined, path)
  }
  assert.equal(reader.readSnapshot('folder/inside.md')?.text, 'inside')
})

test('readSnapshot refuses replacement after path inspection', (t) => {
  const { root, reader } = fixture(t)
  const file = join(root, 'notes.md')
  const oldFile = join(root, 'notes.md.old')
  writeFileSync(file, 'original')
  const originalOpen = fs.openSync
  let replaced = false
  restoreBuiltinMocks(t)
  t.mock.method(fs, 'openSync', (...args: any[]) => {
    const fd = originalOpen(...args)
    if (!replaced) {
      replaced = true
      renameSync(file, oldFile)
      writeFileSync(file, 'replacement')
    }
    return fd
  })
  syncBuiltinESMExports()

  assert.equal(reader.readSnapshot('notes.md'), undefined)
  assert.equal(replaced, true)
})

test('readSnapshot refuses growth after descriptor open', (t) => {
  const { root, reader } = fixture(t)
  const file = join(root, 'notes.md')
  writeFileSync(file, 'before')
  const originalOpen = fs.openSync
  let grew = false
  restoreBuiltinMocks(t)
  t.mock.method(fs, 'openSync', (...args: any[]) => {
    const fd = originalOpen(...args)
    if (!grew) {
      grew = true
      appendFileSync(file, '-after-open')
    }
    return fd
  })
  syncBuiltinESMExports()

  assert.equal(reader.readSnapshot('notes.md'), undefined)
  assert.equal(grew, true)
})
