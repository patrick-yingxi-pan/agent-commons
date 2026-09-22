/** The served-filesystem reader must confine every filesystem operation to its
 * configured root, including when directory entries are symlinks or broken
 * entries rather than ordinary user content. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  renameSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fsReader } from './fs.ts'

function fixture(t: { after: (cleanup: () => void) => void }) {
  const root = mkdtempSync(join(tmpdir(), 'agent-commons-fs-root-'))
  const outside = mkdtempSync(join(tmpdir(), 'agent-commons-fs-outside-'))
  t.after(() => {
    rmSync(root, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  })

  const outsideFile = join(outside, 'secret.md')
  const outsideDirectory = join(outside, 'secret-dir')
  writeFileSync(outsideFile, 'outside bytes must never be served')
  mkdirSync(outsideDirectory)
  writeFileSync(join(outsideDirectory, 'nested.txt'), 'nested outside bytes')

  mkdirSync(join(root, 'safe'))
  writeFileSync(join(root, 'safe', 'inside.txt'), 'inside bytes')
  symlinkSync(outsideFile, join(root, 'linked.md'))
  symlinkSync(outsideFile, join(root, 'safe', 'linked.txt'))
  symlinkSync(outsideDirectory, join(root, 'linked-dir'))
  symlinkSync(join(outside, 'does-not-exist.txt'), join(root, 'broken.md'))

  return {
    root,
    outsideFile,
    outsideAlias: `../${basename(outside)}/secret.md`,
    reader: fsReader(root),
  }
}

test('fsReader listing omits symlinks and broken entries without crashing', (t) => {
  const { reader } = fixture(t)
  let listed: ReturnType<typeof reader.list> | undefined
  assert.doesNotThrow(() => { listed = reader.list() }, 'unreadable entries do not crash catalog listing')
  assert.ok(listed)
  assert.ok(!listed!.files.some((entry) => entry.name === 'linked.md' || entry.name === 'broken.md'))
  assert.ok(!listed!.photos.some((entry) => entry.name === 'linked.md' || entry.name === 'broken.md'))
  assert.ok(!listed!.folders.some((entry) => entry.name === 'linked-dir'))
  assert.ok(listed!.folders.some((entry) => entry.name === 'safe'))
})

test('fsReader read operations reject outside-file symlinks', (t) => {
  const { reader } = fixture(t)
  assert.equal(reader.readText('linked.md'), undefined)
  assert.equal(reader.readBytes('linked.md'), undefined)
  assert.equal(reader.readText('safe/linked.txt'), undefined)
  assert.equal(reader.readBytes('safe/linked.txt'), undefined)
  assert.equal(reader.readText('linked-dir/nested.txt'), undefined)
  assert.equal(reader.readBytes('linked-dir/nested.txt'), undefined)
})

test('fsReader rejects absolute and root-relative aliases', (t) => {
  const { reader, root, outsideFile, outsideAlias } = fixture(t)
  assert.equal(reader.readText(outsideAlias), undefined)
  assert.equal(reader.readText(outsideFile), undefined)
  assert.equal(reader.readBytes(resolve(outsideFile)), undefined)
  assert.equal(reader.folderContents(root), undefined)
})

test('fsReader folder operations do not expose outside directories or descendants', (t) => {
  const { reader } = fixture(t)
  assert.equal(reader.folderContents('linked-dir'), undefined)
  const safe = reader.folderContents('safe')
  assert.ok(safe)
  assert.deepEqual(safe!.artifacts.map((entry) => entry.name), ['inside.txt'])
})

test('in-root symlinks are refused too, while exact visible file handles still work', (t) => {
  const { root, reader } = fixture(t)
  symlinkSync(join(root, 'safe'), join(root, 'inside-dir'))
  symlinkSync(join(root, 'safe', 'inside.txt'), join(root, 'inside-link.txt'))
  symlinkSync(join(root, 'safe', 'inside.txt'), join(root, 'safe', 'inner-link.txt'))
  for (const path of ['inside-link.txt', 'inside-dir/inside.txt', 'safe/inner-link.txt']) {
    assert.equal(reader.readText(path), undefined, path)
    assert.equal(reader.readBytes(path), undefined, path)
  }
  assert.equal(reader.folderContents('inside-dir'), undefined)
  assert.deepEqual(reader.list().folders.map((entry) => [entry.name, entry.fileCount]), [['safe', 1]])
  assert.deepEqual(reader.list().files, [])
  assert.equal(reader.readText('safe/inside.txt')?.text, 'inside bytes')
  assert.deepEqual(reader.folderContents('safe')?.artifacts.map((entry) => entry.name), ['inside.txt'])

  for (const name of ['space name.md', '百分比%.md', 'section::notes.md', 'hash#question?.md']) {
    writeFileSync(join(root, name), name)
    assert.equal(reader.readText(name)?.text, name)
    assert.ok(reader.list().files.some((file) => file.id === name))
  }
})

test('aliases, hidden entries and malformed handles cannot bypass the catalog policy', (t) => {
  const { root, reader } = fixture(t)
  mkdirSync(join(root, '.private'))
  writeFileSync(join(root, '.private', 'notes.md'), 'hidden')
  writeFileSync(join(root, '.hidden.md'), 'hidden')
  for (const path of ['', '.', './safe/inside.txt', 'safe//inside.txt', 'safe/../safe/inside.txt',
    '/safe/inside.txt', join(root, 'safe', 'inside.txt'), 'safe\\inside.txt', 'safe/inside.txt\0',
    'safe/inside.txt/', 'C:/safe/inside.txt', 'C:safe/inside.txt', '.hidden.md', '.private/notes.md']) {
    assert.equal(reader.readText(path), undefined, JSON.stringify(path))
    assert.equal(reader.readBytes(path), undefined, JSON.stringify(path))
    assert.equal(reader.folderContents(path), undefined, JSON.stringify(path))
  }
})

test('configured root aliases are pinned, and replacement roots are not silently adopted', (t) => {
  const parent = mkdtempSync(join(tmpdir(), 'agent-commons-fs-anchor-'))
  t.after(() => rmSync(parent, { recursive: true, force: true }))
  const root = join(parent, 'root')
  const alias = join(parent, 'configured-alias')
  mkdirSync(root)
  writeFileSync(join(root, 'notes.md'), 'original')
  symlinkSync(root, alias)
  const reader = fsReader(alias)
  assert.equal(reader.readText('notes.md')?.text, 'original')
  renameSync(root, join(parent, 'old-root'))
  mkdirSync(root)
  writeFileSync(join(root, 'notes.md'), 'replacement')
  assert.deepEqual(reader.list(), { files: [], photos: [], folders: [] })
  assert.equal(reader.readText('notes.md'), undefined)
  assert.equal(reader.readBytes('notes.md'), undefined)
  assert.equal(fsReader(alias).readText('notes.md')?.text, 'replacement', 'only a new reader adopts a configured root')
})

test('special files are neither catalog entries nor readable content', { skip: process.platform === 'win32' }, (t) => {
  const { root, reader } = fixture(t)
  execFileSync('mkfifo', [join(root, 'pipe.png')])
  execFileSync('mkfifo', [join(root, 'safe', 'pipe.txt')])
  assert.deepEqual(reader.list().photos, [])
  assert.equal(reader.list().folders.find((entry) => entry.name === 'safe')?.fileCount, 1)
  assert.deepEqual(reader.folderContents('safe')?.artifacts.map((entry) => entry.name), ['inside.txt'])
  for (const path of ['pipe.png', 'safe/pipe.txt']) {
    assert.equal(reader.readText(path), undefined)
    assert.equal(reader.readBytes(path), undefined)
  }
})
