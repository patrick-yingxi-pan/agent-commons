import { test } from 'node:test'
import assert from 'node:assert/strict'
import { paths } from './keys.ts'

test('served entry operations share exact source/path encoding without changing their route or default scope', () => {
  const source = 'runner:a/b?c&d#é'
  const path = 'folder/a +?&#😀.md'
  for (const [build, route] of [
    [paths.fsFolder, '/fs/folder'], [paths.fsText, '/fs/text'],
    [paths.fsSnapshot, '/fs/snapshot'], [paths.fsFolderSnapshot, '/fs/folder-snapshot'],
    [paths.fsContent, '/fs/content'],
  ] as const) {
    const url = new URL(build(source, path), 'https://test.invalid')
    assert.equal(url.pathname, route)
    assert.deepEqual([...url.searchParams], [['source', source], ['path', path]])
    assert.equal(url.hash, '')
  }
  assert.equal(paths.fsFolderSnapshot(source, path, 'flat'), paths.fsFolderSnapshot(source, path))
  const recursive = new URL(paths.fsFolderSnapshot(source, path, 'recursive'), 'https://test.invalid')
  assert.deepEqual([...recursive.searchParams], [['source', source], ['path', path], ['scope', 'recursive']])
})

test('every context refresh builder retains its exact encoded session/item route', () => {
  for (const [build, kind] of [
    [paths.refreshSessionAttachment, 'attachments'],
    [paths.refreshSessionFolder, 'folders'],
    [paths.refreshLocalSessionFolder, 'local-folders'],
  ] as const) {
    assert.equal(build('session/a?', 'cloud::a/#é'), `/sessions/session%2Fa%3F/${kind}/cloud%3A%3Aa%2F%23%C3%A9/refresh`)
  }
})
