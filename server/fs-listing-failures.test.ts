/** A successful empty scan is not interchangeable with an unavailable tree. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fsReader } from './fs.ts'

function fixture(t: any) {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'agent-commons-fs-listing-')))
  const root = join(parent, 'root')
  mkdirSync(root)
  mkdirSync(join(root, 'folder'))
  writeFileSync(join(root, 'notes.md'), 'real content')
  writeFileSync(join(root, 'folder', 'inside.txt'), 'nested content')
  t.after(() => {
    t.mock.restoreAll()
    syncBuiltinESMExports()
    rmSync(parent, { recursive: true, force: true })
  })
  return { parent, root, reader: fsReader(root) }
}

function failScan(t: any, path: string) {
  const original = fs.readdirSync
  let calls = 0
  t.mock.method(fs, 'readdirSync', (...args: any[]) => {
    if (args[0] === path) {
      calls++
      throw Object.assign(new Error(`EACCES: private path ${path}`), { code: 'EACCES' })
    }
    return original(...args)
  })
  syncBuiltinESMExports()
  return () => calls
}

test('failed root enumeration is unavailable, not an empty catalog, and can recover', (t) => {
  const { root, reader } = fixture(t)
  assert.equal(reader.list()?.files[0].name, 'notes.md')
  const calls = failScan(t, root)
  const result = reader.list()
  assert.equal(calls(), 1, 'the real reader reached the failing syscall')
  assert.equal(result, undefined)
  t.mock.restoreAll()
  syncBuiltinESMExports()
  assert.equal(reader.list()?.files[0].name, 'notes.md', 'retry rereads the same pinned root')
})

test('failed folder enumeration cannot fabricate an empty workspace or zero count', (t) => {
  const { root, reader } = fixture(t)
  assert.equal(reader.folderContents('folder')?.artifacts.length, 1)
  const calls = failScan(t, join(root, 'folder'))
  const folder = reader.folderContents('folder')
  const catalog = reader.list()
  assert.equal(calls(), 2)
  assert.equal(folder, undefined)
  assert.equal(catalog, undefined, 'a catalog cannot claim an unreadable folder has zero files')
})

test('missing and replaced roots remain unavailable, while genuinely empty trees succeed', (t) => {
  const { parent, root, reader } = fixture(t)
  const empty = join(parent, 'empty')
  mkdirSync(empty)
  assert.deepEqual(fsReader(empty).list(), { files: [], photos: [], folders: [] })
  assert.equal(fsReader(join(parent, 'missing')).list(), undefined)
  renameSync(root, join(parent, 'original'))
  mkdirSync(root)
  assert.equal(reader.list(), undefined, 'a replacement is not the acknowledged empty tree')
})

test('a folder replaced during enumeration is unavailable rather than an empty workspace', (t) => {
  const { root, reader } = fixture(t)
  const original = fs.readdirSync
  let replaced = false
  t.mock.method(fs, 'readdirSync', (...args: any[]) => {
    const names = original(...args)
    if (!replaced && args[0] === join(root, 'folder')) {
      replaced = true
      renameSync(join(root, 'folder'), join(root, 'old-folder'))
      mkdirSync(join(root, 'folder'))
    }
    return names
  })
  syncBuiltinESMExports()
  const result = reader.folderContents('folder')
  assert.equal(replaced, true)
  assert.equal(result, undefined)
})

test('a root lost during child inspection cannot publish a partial catalog', (t) => {
  const { parent, root, reader } = fixture(t)
  const original = fs.lstatSync
  let replaced = false
  t.mock.method(fs, 'lstatSync', (...args: any[]) => {
    const st = original(...args)
    if (!replaced && args[0] === join(root, 'notes.md')) {
      replaced = true
      renameSync(root, join(parent, 'original'))
      mkdirSync(root)
    }
    return st
  })
  syncBuiltinESMExports()
  const catalog = reader.list()
  assert.equal(replaced, true, 'the root was replaced after enumeration, during child inspection')
  assert.equal(catalog, undefined)
})
