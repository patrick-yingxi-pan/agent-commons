/** Served folder capture is a bounded batch, never a recursive/live handle. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fsReader } from './fs.ts'

function fixture(t: any) {
  const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'agent-commons-folder-capture-')))
  const folder = join(root, 'folder')
  fs.mkdirSync(folder)
  t.after(() => {
    t.mock.restoreAll()
    syncBuiltinESMExports()
    fs.rmSync(root, { recursive: true, force: true })
  })
  return { root, folder, reader: fsReader(root) }
}

test('folderSnapshot captures sorted whole text and explicit omissions, without paths or nested content', async (t) => {
  const { root, folder, reader } = fixture(t)
  const text = '\uFEFFHéllo\r\n世界\n'
  fs.writeFileSync(join(folder, 'z.md'), text)
  fs.writeFileSync(join(folder, 'empty.txt'), '')
  fs.writeFileSync(join(folder, 'bad.txt'), Buffer.from([0xc3, 0x28]))
  fs.writeFileSync(join(folder, 'binary.txt'), 'a\0b')
  fs.writeFileSync(join(folder, 'photo.png'), 'not a text format')
  fs.writeFileSync(join(folder, 'large.md'), Buffer.alloc(65537, 0x61))
  fs.writeFileSync(join(folder, '.secret.md'), 'secret')
  fs.mkdirSync(join(folder, 'nested'))
  fs.writeFileSync(join(folder, 'nested', 'inside.md'), 'nested')
  fs.symlinkSync(join(folder, 'z.md'), join(folder, 'alias.md'))
  fs.symlinkSync(join(root, 'absent'), join(folder, 'broken.md'))
  const result = await reader.folderSnapshot('folder')
  assert.deepEqual(result, [
    { name: 'bad.txt', sizeBytes: 2, snapshot: { omitted: 'unreadable' } },
    { name: 'binary.txt', sizeBytes: 3, snapshot: { omitted: 'unreadable' } },
    { name: 'empty.txt', sizeBytes: 0, snapshot: { text: '' } },
    { name: 'large.md', sizeBytes: 65537, snapshot: { omitted: 'too-large' } },
    { name: 'photo.png', sizeBytes: 17, snapshot: { omitted: 'unsupported' } },
    { name: 'z.md', sizeBytes: Buffer.byteLength(text), snapshot: { text } },
  ])
  assert.equal(JSON.stringify(result).includes(root), false)
})

test('folderSnapshot shares the whole-file byte budget and never opens known excluded bodies', async (t) => {
  const { folder, reader } = fixture(t)
  for (const [name, body] of [
    ['a.md', 'é'.repeat(32768)], ['b.md', 'b'.repeat(65536)],
    ['c.md', 'c'], ['d.zip', 'archive'], ['e.md', 'e'.repeat(65537)],
  ]) fs.writeFileSync(join(folder, name), body)
  const originalOpen = fs.openSync
  const opened: string[] = []
  t.mock.method(fs, 'openSync', (...args: any[]) => { opened.push(args[0]); return originalOpen(...args) })
  syncBuiltinESMExports()
  const result = await reader.folderSnapshot('folder')
  assert.deepEqual(opened, [join(folder, 'a.md'), join(folder, 'b.md')])
  assert.equal(Buffer.byteLength(result![0].snapshot.text!), 65536)
  assert.equal(Buffer.byteLength(result![1].snapshot.text!), 65536)
  assert.deepEqual(result!.slice(2).map((entry) => entry.snapshot), [
    { omitted: 'budget' }, { omitted: 'unsupported' }, { omitted: 'too-large' },
  ])
})

test('folderSnapshot reads at most 24 files including empty text', async (t) => {
  const { folder, reader } = fixture(t)
  for (let i = 0; i < 25; i++) fs.writeFileSync(join(folder, `${String(i).padStart(2, '0')}.txt`), '')
  const result = await reader.folderSnapshot('folder')
  assert.equal(result!.filter((entry) => entry.snapshot.text === '').length, 24)
  assert.deepEqual(result![24].snapshot, { omitted: 'budget' })
})

test('folderSnapshot stops enumeration at entry 501 before reads, counting hidden entries and directories', async (t) => {
  const { folder, reader } = fixture(t)
  fs.writeFileSync(join(folder, 'a.md'), 'read me')
  for (let i = 0; i < 498; i++) fs.writeFileSync(join(folder, `.hidden-${i}`), '')
  fs.mkdirSync(join(folder, 'nested'))
  assert.deepEqual(await reader.folderSnapshot('folder'), [{ name: 'a.md', sizeBytes: 7, snapshot: { text: 'read me' } }])
  fs.writeFileSync(join(folder, '.entry-501'), '')
  fs.writeFileSync(join(folder, '.entry-502'), '')
  const originalOpen = fs.opendirSync
  let nexts = 0
  let closes = 0
  t.mock.method(fs, 'opendirSync', (...args: any[]) => {
    const directory = originalOpen(...args)
    return {
      readSync() { nexts++; return directory.readSync() },
      closeSync() { closes++; directory.closeSync() },
    }
  })
  const bodyOpen = t.mock.method(fs, 'openSync', () => { throw new Error('oversized enumeration must not reach file bodies') })
  syncBuiltinESMExports()
  assert.equal(await reader.folderSnapshot('folder'), undefined)
  assert.equal(nexts, 501)
  assert.equal(closes, 1)
  assert.equal(bodyOpen.mock.callCount(), 0)
})

test('folderSnapshot distinguishes empty folders from missing, unsafe and unenumerable paths', async (t) => {
  const { root, folder, reader } = fixture(t)
  assert.deepEqual(await reader.folderSnapshot('folder'), [])
  fs.symlinkSync(folder, join(root, 'linked'))
  fs.writeFileSync(join(root, 'file.md'), 'file')
  for (const path of ['', 'missing', 'linked', 'linked/child', 'file.md', '/folder', '.private', 'folder/..', 'folder//child', 'folder\\child']) {
    assert.equal(await reader.folderSnapshot(path), undefined, path)
  }
  t.mock.method(fs, 'opendirSync', () => { throw new Error('directory unavailable') })
  syncBuiltinESMExports()
  assert.equal(await reader.folderSnapshot('folder'), undefined)
})

test('folderSnapshot closes a failed enumeration and never turns it into an empty success', async (t) => {
  const { reader } = fixture(t)
  let closes = 0
  t.mock.method(fs, 'opendirSync', () => ({
    readSync() { throw new Error('directory read failed') },
    closeSync() { closes++ },
  }))
  syncBuiltinESMExports()
  assert.equal(await reader.folderSnapshot('folder'), undefined)
  assert.equal(closes, 1)
})

test('folderSnapshot refuses a directory changed or replaced while asynchronous capture is pending', async (t) => {
  const { root, folder, reader } = fixture(t)
  fs.writeFileSync(join(folder, 'a.md'), 'first')
  const changed = reader.folderSnapshot('folder')
  fs.writeFileSync(join(folder, 'later.md'), 'must not publish an incomplete listing')
  assert.equal(await changed, undefined)
  const replaced = reader.folderSnapshot('folder')
  fs.renameSync(folder, join(root, 'original'))
  fs.mkdirSync(folder)
  assert.equal(await replaced, undefined)
  assert.deepEqual(await reader.folderSnapshot('folder'), [], 'an explicit new capture may select the new folder under the same pinned root')
})

test('folderSnapshot refuses loss of a listed regular file before metadata admission', async (t) => {
  const { folder, reader } = fixture(t)
  fs.writeFileSync(join(folder, 'a.md'), 'content')
  const original = fs.lstatSync
  t.mock.method(fs, 'lstatSync', (...args: any[]) => {
    if (args[0] === join(folder, 'a.md')) throw new Error('stat denied')
    return original(...args)
  })
  syncBuiltinESMExports()
  assert.equal(await reader.folderSnapshot('folder'), undefined, 'do not silently erase known regular files from a capture')
})

test('folderSnapshot records changed-size or failed descriptor reads as explicit omissions', async (t) => {
  const { folder, reader } = fixture(t)
  fs.writeFileSync(join(folder, 'a.md'), 'original')
  fs.writeFileSync(join(folder, 'b.md'), 'second')
  const originalOpen = fs.openSync
  t.mock.method(fs, 'openSync', (...args: any[]) => {
    if (args[0] === join(folder, 'a.md')) {
      const append = originalOpen(args[0], 'a')
      try { fs.appendFileSync(append, '-grew') } finally { fs.closeSync(append) }
    }
    if (args[0] === join(folder, 'b.md')) throw new Error('file read denied')
    return originalOpen(...args)
  })
  syncBuiltinESMExports()
  const result = await reader.folderSnapshot('folder')
  assert.deepEqual(result, [
    { name: 'a.md', sizeBytes: 8, snapshot: { omitted: 'unreadable' } },
    { name: 'b.md', sizeBytes: 6, snapshot: { omitted: 'unreadable' } },
  ])
})
