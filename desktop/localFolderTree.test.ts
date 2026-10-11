import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { buildGitFileTestHelper } from './gitFileTestFixture.mjs'
import { inspectLocalFolderRoot } from './localFolderReader.mjs'
import { readLocalFolderTree } from './localFolderTree.mjs'
import { listLocalFolderTree, readGitFile } from './gitFileRead.mjs'
import { MAX_FOLDER_TREE_DEPTH, MAX_FOLDER_TREE_DIRECTORIES, MAX_FOLDER_TREE_ENTRIES, MAX_FOLDER_TREE_PATH_BYTES } from '../contract/localFolderTree.mjs'

const executable = buildGitFileTestHelper()

test('native traversal bounds equal the portable contract bounds', () => {
  const source = readFileSync(new URL('./native/git-file.c', import.meta.url), 'utf8')
  for (const [name, value] of Object.entries({
    TREE_MAX_ENTRIES: MAX_FOLDER_TREE_ENTRIES, TREE_MAX_DIRECTORIES: MAX_FOLDER_TREE_DIRECTORIES,
    TREE_MAX_DEPTH: MAX_FOLDER_TREE_DEPTH, TREE_MAX_PATH_BYTES: MAX_FOLDER_TREE_PATH_BYTES,
  })) assert.ok(source.includes(`#define ${name} ${value}U`), `${name} matches the shared policy`)
})

test('recursive native folder capture retains relative names and shared omissions without following hidden trees or links', { skip: process.platform !== 'darwin' }, async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), 'agent-commons-folder-tree-'))
  t.after(() => rm(temporary, { recursive: true, force: true }))
  const path = join(temporary, 'project')
  await mkdir(join(path, 'src', 'empty'), { recursive: true })
  await mkdir(join(path, '.git'), { recursive: true })
  await writeFile(join(path, 'readme.md'), 'root text')
  await writeFile(join(path, 'src', 'readme.md'), 'nested text')
  await writeFile(join(path, 'src', 'image.png'), 'opaque')
  await writeFile(join(path, '.git', 'config'), 'private hidden text')
  await writeFile(join(temporary, 'outside.md'), 'outside private text')
  await symlink(join(temporary, 'outside.md'), join(path, 'linked.md'))
  await symlink(temporary, join(path, 'linked-tree'))
  const bodyReads: string[] = []
  const result = await readLocalFolderTree(await inspectLocalFolderRoot(path), { executable,
    readFile: async (root, name, options) => { bodyReads.push(name); return readGitFile(root, name, options) },
  })
  assert.deepEqual(result, { name: 'project', files: [
    { name: 'readme.md', sizeBytes: 9, snapshot: { text: 'root text' } },
    { name: 'src/image.png', sizeBytes: 6, snapshot: { omitted: 'unsupported' } },
    { name: 'src/readme.md', sizeBytes: 11, snapshot: { text: 'nested text' } },
  ] })
  assert.equal(JSON.stringify(result).includes(temporary), false)
  assert.deepEqual(bodyReads, ['readme.md', 'src/readme.md'], 'only admitted visible regular text gets a body read')
})

test('recursive native folder capture refuses raw-entry, empty-directory and depth overflows as whole captures', { skip: process.platform !== 'darwin' }, async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), 'agent-commons-folder-tree-bounds-'))
  t.after(() => rm(temporary, { recursive: true, force: true }))
  const entries = join(temporary, 'entries')
  await mkdir(entries)
  await Promise.all(Array.from({ length: 501 }, (_, index) => writeFile(join(entries, `.hidden-${index}`), '')))
  await assert.rejects(readLocalFolderTree(await inspectLocalFolderRoot(entries), { executable }), /unavailable|changed|limit/)
  const directories = join(temporary, 'directories')
  await mkdir(directories)
  await Promise.all(Array.from({ length: 65 }, (_, index) => mkdir(join(directories, `empty-${index}`))))
  await assert.rejects(readLocalFolderTree(await inspectLocalFolderRoot(directories), { executable }), /unavailable|changed|limit/)
  const deep = join(temporary, 'deep')
  await mkdir(join(deep, ...Array.from({ length: 17 }, () => 'nested')), { recursive: true })
  await assert.rejects(readLocalFolderTree(await inspectLocalFolderRoot(deep), { executable }), /unavailable|changed|limit/)
})

test('recursive captures retain the shared 24-file, 64-KiB/file and 128-KiB aggregate text limits', { skip: process.platform !== 'darwin' }, async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), 'agent-commons-folder-tree-text-'))
  t.after(() => rm(temporary, { recursive: true, force: true }))
  await mkdir(join(temporary, 'nested'))
  await writeFile(join(temporary, 'nested', 'a.txt'), 'a'.repeat(64 * 1024))
  await writeFile(join(temporary, 'nested', 'b.txt'), 'b'.repeat(64 * 1024))
  await writeFile(join(temporary, 'nested', 'c.txt'), 'c')
  await writeFile(join(temporary, 'nested', 'large.txt'), 'x'.repeat(64 * 1024 + 1))
  const result = await readLocalFolderTree(await inspectLocalFolderRoot(temporary), { executable })
  assert.equal(result.files[0].snapshot.text.length, 64 * 1024)
  assert.equal(result.files[1].snapshot.text.length, 64 * 1024)
  assert.deepEqual(result.files[2].snapshot, { omitted: 'budget' })
  assert.deepEqual(result.files[3].snapshot, { omitted: 'too-large' })
  const small = join(temporary, 'small')
  await mkdir(small)
  for (let index = 0; index < 25; index++) await writeFile(join(small, `${String(index).padStart(2, '0')}.txt`), 'x')
  const limited = await readLocalFolderTree(await inspectLocalFolderRoot(small), { executable })
  assert.equal(limited.files.filter((file) => 'text' in file.snapshot).length, 24)
  assert.deepEqual(limited.files[24].snapshot, { omitted: 'budget' })
})

test('recursive capture rejects changed read versions even if later enumeration appears unchanged', async () => {
  const root = { path: '/private/folder', identity: { dev: '1', ino: '2' } }
  const state = { rootVersion: 'root', visited: 1, directoryCount: 0, entries: [
    { kind: 'F', name: 'readme.md', sizeBytes: 3, version: 'initial' },
  ] }
  let reads = 0
  await assert.rejects(readLocalFolderTree(root, {
    listTree: async () => state,
    readFile: async () => { reads++; return { status: 'file', sizeBytes: 3, version: 'changed', bytes: Buffer.from('new') } },
  }), /changed/)
  assert.equal(reads, 1)
})

test('recursive capture rechecks unread and omitted file versions plus empty directories after body reads', { skip: process.platform !== 'darwin' }, async (t) => {
  for (const mutation of ['omitted', 'empty-directory', 'subdirectory-link', 'root-replacement']) {
    const temporary = await mkdtemp(join(tmpdir(), 'agent-commons-folder-tree-changed-'))
    t.after(() => rm(temporary, { recursive: true, force: true }))
    const path = join(temporary, 'project')
    await mkdir(join(path, 'nested'), { recursive: true })
    await mkdir(join(path, 'empty'))
    await writeFile(join(path, 'nested', 'readme.md'), 'source')
    await writeFile(join(path, 'image.png'), 'opaque')
    const root = await inspectLocalFolderRoot(path)
    let mutated = false
    await assert.rejects(readLocalFolderTree(root, { executable,
      readFile: async (...args) => {
        const result = await readGitFile(...args)
        if (!mutated) {
          mutated = true
          if (mutation === 'omitted') await writeFile(join(path, 'image.png'), 'changed opaque')
          else if (mutation === 'empty-directory') await writeFile(join(path, 'empty', 'new.md'), 'added')
          else if (mutation === 'subdirectory-link') {
            await rename(join(path, 'nested'), join(path, 'parked'))
            await symlink(join(path, 'parked'), join(path, 'nested'))
          } else {
            await rename(path, join(temporary, 'parked'))
            await mkdir(path)
          }
        }
        return result
      },
    }), /changed/, mutation)
    assert.equal(mutated, true)
  }
})

test('recursive capture cancellation and helper errors cannot publish a partial unreadable snapshot', async () => {
  const root = { path: '/private/folder', identity: { dev: '1', ino: '2' } }
  const controller = new AbortController()
  controller.abort()
  let calls = 0
  await assert.rejects(readLocalFolderTree(root, { signal: controller.signal,
    listTree: async () => { calls++; throw new Error('must not read') },
  }), /cancelled/)
  assert.equal(calls, 0)
  await assert.rejects(readLocalFolderTree(root, {
    listTree: async () => ({ entries: [{ kind: 'F', name: 'readme.md', sizeBytes: 1, version: 'old' }] }),
    readFile: async () => { throw new Error('/private/sensitive/native-error') },
  }), (error: Error) => /changed/.test(error.message) && !error.message.includes('sensitive'))
})

test('recursive enumeration admits maximum depth and empty-directory bounds and rejects invalid visible names', { skip: process.platform !== 'darwin' }, async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), 'agent-commons-folder-tree-edge-'))
  t.after(() => rm(temporary, { recursive: true, force: true }))
  const rootPath = join(temporary, 'root')
  await mkdir(rootPath)
  await Promise.all(Array.from({ length: 64 }, (_, index) => mkdir(join(rootPath, `empty-${index}`))))
  assert.equal((await listLocalFolderTree(await inspectLocalFolderRoot(rootPath), { executable })).directoryCount, 64)
  const deepPath = join(temporary, 'deep')
  const deepFile = join(deepPath, ...Array.from({ length: 16 }, () => 'nested'), 'file.md')
  await mkdir(join(deepFile, '..'), { recursive: true })
  await writeFile(deepFile, 'deep')
  const deep = await readLocalFolderTree(await inspectLocalFolderRoot(deepPath), { executable })
  assert.equal(deep.files[0].name, `${'nested/'.repeat(16)}file.md`)
  for (const name of ['bad\\name.md', 'C:drive.md', 'bad\u0085name.md']) {
    const invalid = join(temporary, `invalid-${Buffer.from(name).toString('hex')}`)
    await mkdir(invalid)
    await writeFile(join(invalid, name), 'unsafe name')
    await assert.rejects(readLocalFolderTree(await inspectLocalFolderRoot(invalid), { executable }), /unavailable|changed/)
  }
})
