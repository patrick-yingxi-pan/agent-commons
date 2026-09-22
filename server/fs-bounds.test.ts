/** Bounded reads from the served filesystem: admission, decoding, partial
 * syscalls, and replacement/growth checks all happen against owned fixtures. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fsReader, MAX_CONTENT_BYTES, MAX_TEXT_BYTES } from './fs.ts'

function fixture(t: { after: (cleanup: () => void) => void }) {
  const root = mkdtempSync(join(tmpdir(), 'agent-commons-fs-bounds-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return { root, reader: fsReader(root) }
}

function restoreBuiltinMocks(t: { after: (cleanup: () => void) => void; mock: { restoreAll: () => void } }) {
  t.after(() => {
    t.mock.restoreAll()
    syncBuiltinESMExports()
  })
}

test('readBytes admits exactly 32 MiB and refuses one byte over', (t) => {
  const { root, reader } = fixture(t)
  const exact = Buffer.alloc(MAX_CONTENT_BYTES, 0x5a)
  writeFileSync(join(root, 'exact.bin'), exact)
  writeFileSync(join(root, 'over.bin'), Buffer.concat([exact, Buffer.from([0x21])]))

  const accepted = reader.readBytes('exact.bin')
  assert.ok(accepted)
  assert.equal(accepted!.bytes.length, MAX_CONTENT_BYTES)
  assert.equal(accepted!.bytes[0], 0x5a)
  assert.ok(reader.readBytes('over.bin') === undefined, 'an over-limit raw file is unavailable')
})

test('readText admits exactly 256 KiB and returns the existing oversize note', (t) => {
  const { root, reader } = fixture(t)
  const exact = 'x'.repeat(MAX_TEXT_BYTES)
  writeFileSync(join(root, 'exact.txt'), exact)
  writeFileSync(join(root, 'over.txt'), `${exact}y`)

  const accepted = reader.readText('exact.txt')
  assert.equal(accepted?.kind, 'text')
  assert.equal(accepted?.text, exact)
  const refused = reader.readText('over.txt')
  assert.equal(refused?.kind, 'text')
  assert.match(refused?.text ?? '', /over\.txt is .*too large to preview/)
})

test('readText handles empty files and preserves a literal UTF-8 BOM', (t) => {
  const { root, reader } = fixture(t)
  writeFileSync(join(root, 'empty.txt'), Buffer.alloc(0))
  writeFileSync(join(root, 'bom.txt'), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('hello')]))

  assert.equal(reader.readText('empty.txt')?.text, '')
  assert.equal(reader.readText('bom.txt')?.text, '\uFEFFhello')
})

test('readBytes completes partial read syscalls without requesting beyond admitted size plus one', (t) => {
  const { root, reader } = fixture(t)
  const content = Buffer.from('partial reads must be reassembled exactly')
  const file = join(root, 'partial.bin')
  writeFileSync(file, content)
  const calls: number[] = []
  const originalRead = fs.readSync
  restoreBuiltinMocks(t)
  t.mock.method(fs, 'readSync', (...args: any[]) => {
    const length = args[3] as number
    calls.push(length)
    return originalRead(args[0], args[1], args[2], Math.min(length, 3), args[4])
  })
  syncBuiltinESMExports()

  const got = reader.readBytes('partial.bin')
  assert.ok(got)
  assert.deepEqual(Buffer.from(got!.bytes), content)
  assert.ok(calls.length > 1, 'the wrapper forced more than one read syscall')
  assert.ok(Math.max(...calls) <= content.length + 1)
})

test('readBytes closes its descriptor when growth is detected after open', (t) => {
  const { root, reader } = fixture(t)
  const file = join(root, 'growing.bin')
  writeFileSync(file, 'before')
  const originalOpen = fs.openSync
  const originalClose = fs.closeSync
  const closed: number[] = []
  let readerFd: number | undefined
  let mutated = false
  restoreBuiltinMocks(t)
  t.mock.method(fs, 'openSync', (...args: any[]) => {
    const fd = originalOpen(...args)
    if (!mutated) {
      readerFd = fd
      mutated = true
      appendFileSync(file, '-after-open')
    }
    return fd
  })
  t.mock.method(fs, 'closeSync', (fd: number) => {
    closed.push(fd)
    return originalClose(fd)
  })
  syncBuiltinESMExports()

  assert.equal(reader.readBytes('growing.bin'), undefined)
  assert.equal(mutated, true, 'the fixture grew after the descriptor opened')
  assert.equal(closed.filter((fd) => fd === readerFd).length, 1, 'the failed bounded read closed its descriptor once')
})

test('readBytes refuses replacement after the admitted entry is inspected', (t) => {
  const { root, reader } = fixture(t)
  const file = join(root, 'replaced.bin')
  const oldFile = join(root, 'replaced.bin.old')
  writeFileSync(file, 'old contents')
  const originalOpen = fs.openSync
  let replaced = false
  restoreBuiltinMocks(t)
  t.mock.method(fs, 'openSync', (...args: any[]) => {
    const fd = originalOpen(...args)
    if (!replaced) {
      replaced = true
      renameSync(file, oldFile)
      writeFileSync(file, 'replacement contents')
    }
    return fd
  })
  syncBuiltinESMExports()

  assert.equal(reader.readBytes('replaced.bin'), undefined)
  assert.equal(replaced, true, 'the fixture was replaced after inspection')
  assert.equal(readFileSync(oldFile, 'utf8'), 'old contents')
  assert.equal(readFileSync(file, 'utf8'), 'replacement contents')
})

test('readBytes rejects growth during a read and closes the reader descriptor', (t) => {
  const { root, reader } = fixture(t)
  const file = join(root, 'growing-during-read.bin')
  writeFileSync(file, 'before')
  const originalRead = fs.readSync
  const originalOpen = fs.openSync
  const originalClose = fs.closeSync
  const closed: number[] = []
  let readerFd: number | undefined
  let mutated = false
  restoreBuiltinMocks(t)
  t.mock.method(fs, 'openSync', (...args: any[]) => {
    const fd = originalOpen(...args)
    if (readerFd === undefined) readerFd = fd
    return fd
  })
  t.mock.method(fs, 'readSync', (...args: any[]) => {
    const count = originalRead(args[0], args[1], args[2], args[3], args[4])
    if (!mutated) {
      mutated = true
      appendFileSync(file, '-during-read')
    }
    return count
  })
  t.mock.method(fs, 'closeSync', (fd: number) => {
    closed.push(fd)
    return originalClose(fd)
  })
  syncBuiltinESMExports()

  assert.equal(reader.readBytes('growing-during-read.bin'), undefined)
  assert.equal(mutated, true, 'the fixture grew after the first read syscall')
  assert.equal(closed.filter((fd) => fd === readerFd).length, 1, 'the reader descriptor closed once')
})

test('readBytes closes its descriptor when the read syscall throws', (t) => {
  const { root, reader } = fixture(t)
  const file = join(root, 'throwing-read.bin')
  writeFileSync(file, 'read failure')
  const originalOpen = fs.openSync
  const originalClose = fs.closeSync
  const closed: number[] = []
  let readerFd: number | undefined
  restoreBuiltinMocks(t)
  t.mock.method(fs, 'openSync', (...args: any[]) => {
    readerFd = originalOpen(...args)
    return readerFd
  })
  t.mock.method(fs, 'readSync', () => {
    throw new Error('synthetic read failure')
  })
  t.mock.method(fs, 'closeSync', (fd: number) => {
    closed.push(fd)
    return originalClose(fd)
  })
  syncBuiltinESMExports()

  assert.equal(reader.readBytes('throwing-read.bin'), undefined)
  assert.equal(closed.filter((fd) => fd === readerFd).length, 1, 'the throwing read closed its descriptor once')
})

test('folderContents tolerates a child disappearing between enumeration and inspection', (t) => {
  const { root, reader } = fixture(t)
  const folder = join(root, 'folder')
  const kept = join(folder, 'kept.txt')
  const gone = join(folder, 'gone.txt')
  mkdirSync(folder)
  writeFileSync(kept, 'kept')
  writeFileSync(gone, 'gone')
  const originalReaddir = fs.readdirSync
  let removed = false
  restoreBuiltinMocks(t)
  t.mock.method(fs, 'readdirSync', (...args: any[]) => {
    const names = originalReaddir(...args)
    if (!removed) {
      removed = true
      rmSync(gone)
    }
    return names
  })
  syncBuiltinESMExports()

  const result = reader.folderContents('folder')
  assert.equal(removed, true, 'the fixture child was removed after enumeration')
  assert.ok(result)
  assert.deepEqual(result!.artifacts.map((entry) => entry.name), ['kept.txt'])
})
