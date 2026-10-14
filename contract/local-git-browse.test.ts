import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isLocalGitFileSelection, parseLocalGitFileListing, parseLocalGitFilePreview,
  MAX_GIT_BROWSE_ENTRIES, MAX_GIT_BROWSE_FILE_BYTES, MAX_GIT_BROWSE_PATH_BYTES } from './localGitBrowse.mjs'

const listing = (files = [{ path: 'src/app.ts', kind: 'file' }], excludedCount = 0) => ({ version: 1, files, excludedCount })
const preview = (text = '') => ({ version: 1, path: 'src/app.ts', sizeBytes: Buffer.byteLength(text), snapshot: { text } })

test('Git browse data is detached, closed, sorted and relative with explicit unsupported states', () => {
  const source = listing([{ path: 'a.ts', kind: 'conflict' }, { path: 'b', kind: 'sparse' }, { path: 'c.zip', kind: 'unsupported' }], 2)
  const parsed = parseLocalGitFileListing(source)
  assert.deepEqual(parsed, source)
  source.files[0].path = 'changed.ts'
  assert.equal(parsed?.files[0].path, 'a.ts')
  assert.deepEqual(parseLocalGitFileListing(listing([])), listing([]))
  for (const path of ['../x.ts', '/x.ts', 'x\\y.ts', '.git/config', 'src/.GIT/config', 'a/../b.ts', '\ud800.ts']) {
    assert.equal(isLocalGitFileSelection({ path }), false, path)
    assert.equal(parseLocalGitFileListing(listing([{ path, kind: 'file' }])), undefined, path)
  }
  assert.equal(isLocalGitFileSelection({ path: '.config/合法.json' }), true)
  for (const value of [listing([{ path: 'x.zip', kind: 'file' }]), listing([{ path: 'z.ts', kind: 'file' }, { path: 'a.ts', kind: 'file' }]),
    listing([{ path: 'a.ts', kind: 'file' }, { path: 'a.ts', kind: 'file' }]), { ...listing(), nativePath: '/private' },
    listing([{ path: 'a.ts', kind: 'deleted' }]), listing([], -1), listing([], 1.5)]) assert.equal(parseLocalGitFileListing(value), undefined)
})

test('Git browse parsers never execute accessors or accept inherited, sparse or symbol-extended data', () => {
  let called = 0
  const getter = { get path() { called++; return 'src/app.ts' } }
  assert.equal(isLocalGitFileSelection(getter), false)
  assert.equal(isLocalGitFileSelection(Object.assign(Object.create({ extra: true }), { path: 'a.ts' })), false)
  assert.equal(isLocalGitFileSelection({ path: 'a.ts', [Symbol('extra')]: 1 }), false)
  assert.equal(parseLocalGitFileListing({ ...listing(), get files() { called++; return [] } }), undefined)
  assert.equal(parseLocalGitFileListing(listing([getter])), undefined)
  assert.equal(parseLocalGitFileListing(listing(Array(1))), undefined)
  const items = []
  Object.defineProperty(items, '0', { enumerable: true, get() { called++; return { path: 'a.ts', kind: 'file' } } })
  assert.equal(parseLocalGitFileListing(listing(items)), undefined)
  assert.equal(parseLocalGitFilePreview({ ...preview(), snapshot: { get text() { called++; return '' } } }), undefined)
  assert.equal(called, 0)
})

test('Git listing caps include excluded paths and aggregate UTF-8 path bytes without prefix truncation', () => {
  const files = Array.from({ length: MAX_GIT_BROWSE_ENTRIES }, (_, i) => ({ path: `${String(i).padStart(5, '0')}.ts`, kind: 'file' }))
  assert.equal(parseLocalGitFileListing(listing(files))?.files.length, MAX_GIT_BROWSE_ENTRIES)
  assert.equal(parseLocalGitFileListing(listing(files, 1)), undefined)
  assert.equal(parseLocalGitFileListing(listing([...files, { path: 'z.ts', kind: 'file' }])), undefined)
  const long = files.map(file => ({ ...file, path: `${'a'.repeat(200)}/${file.path}` }))
  assert.ok(long.reduce((size, file) => size + Buffer.byteLength(file.path), 0) > MAX_GIT_BROWSE_PATH_BYTES)
  assert.equal(parseLocalGitFileListing(listing(long)), undefined)
})

test('one Git preview is whole exact UTF-8 including empty, BOM and line endings; omissions are not empty text', () => {
  for (const text of ['', '\ufeff你好\r\n', 'x'.repeat(MAX_GIT_BROWSE_FILE_BYTES)]) assert.deepEqual(parseLocalGitFilePreview(preview(text)), preview(text))
  for (const text of ['x'.repeat(MAX_GIT_BROWSE_FILE_BYTES + 1), '\ud800', '\u0000binary', '\u0007bell']) assert.equal(parseLocalGitFilePreview(preview(text)), undefined)
  assert.equal(parseLocalGitFilePreview({ ...preview('hello'), sizeBytes: 4 }), undefined)
  assert.equal(parseLocalGitFilePreview({ ...preview('hello'), path: 'binary.png' }), undefined)
  for (const omitted of ['unsupported', 'unreadable', 'too-large']) {
    const value = { ...preview(), sizeBytes: omitted === 'too-large' ? MAX_GIT_BROWSE_FILE_BYTES + 1 : 0, snapshot: { omitted } }
    assert.deepEqual(parseLocalGitFilePreview(value), value)
  }
  for (const snapshot of [{}, { omitted: 'deleted' }, { omitted: 'too-large' }, { omitted: 'unreadable', text: '' }]) {
    assert.equal(parseLocalGitFilePreview({ ...preview(), snapshot }), undefined)
  }
})
