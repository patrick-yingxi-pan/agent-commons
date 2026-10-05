import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import { lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLocalFolderReader, inspectLocalFolderRoot, readLocalFolderSnapshot } from './localFolderReader.mjs'

const FAILURE = 'The selected folder is unavailable or has changed.'

async function fixture() {
  const parent = await mkdtemp(join(tmpdir(), 'local-folder-reader-'))
  const root = join(parent, 'source')
  await mkdir(root)
  return { parent, root }
}

async function cleanup(path: string) {
  await rm(path, { recursive: true, force: true })
}

test('captures bounded top-level text snapshots without mutating source files', async (t) => {
  const { parent, root } = await fixture()
  t.after(() => cleanup(parent))
  await writeFile(join(root, 'notes.md'), 'hello from the selected folder')
  await writeFile(join(root, 'picture.png'), Buffer.from([0, 1, 2]))
  await writeFile(join(root, '.private.md'), 'hidden text')
  await mkdir(join(root, 'nested'))
  await writeFile(join(root, 'nested', 'ignored.md'), 'not recursive')

  const before = await readFile(join(root, 'notes.md'))
  const pinned = await inspectLocalFolderRoot(root)
  assert.equal(pinned.path, await realpath(root))
  assert.equal(typeof pinned.identity.dev, 'string')
  assert.equal(typeof pinned.identity.ino, 'string')

  const snapshot = await readLocalFolderSnapshot(pinned)
  assert.equal(snapshot.name, 'source')
  assert.deepEqual(snapshot.files, [
    { name: 'notes.md', sizeBytes: before.byteLength, snapshot: { text: 'hello from the selected folder' } },
    { name: 'picture.png', sizeBytes: 3, snapshot: { omitted: 'unsupported' } },
  ])
  assert.deepEqual(await readFile(join(root, 'notes.md')), before)
  assert.equal((await lstat(join(root, 'notes.md'))).isSymbolicLink(), false)
})

test('applies the shared per-file, total-byte, and readable-file limits', async (t) => {
  const { parent, root } = await fixture()
  t.after(() => cleanup(parent))
  for (let index = 0; index < 25; index++) {
    await writeFile(join(root, `${String(index).padStart(2, '0')}.md`), 'x')
  }
  await writeFile(join(root, 'large.md'), Buffer.alloc(64 * 1024 + 1, 0x78))

  const snapshot = await readLocalFolderSnapshot(await inspectLocalFolderRoot(root))
  assert.equal(snapshot.files.length, 26)
  assert.deepEqual(snapshot.files[23], { name: '23.md', sizeBytes: 1, snapshot: { text: 'x' } })
  assert.deepEqual(snapshot.files[24], { name: '24.md', sizeBytes: 1, snapshot: { omitted: 'budget' } })
  assert.deepEqual(snapshot.files[25], { name: 'large.md', sizeBytes: 64 * 1024 + 1, snapshot: { omitted: 'too-large' } })
})

test('counts raw entries before filtering hidden files or directories', async (t) => {
  const { parent, root } = await fixture()
  t.after(() => cleanup(parent))
  for (let index = 0; index < 501; index++) {
    await writeFile(join(root, `.hidden-${String(index).padStart(3, '0')}`), '')
  }

  await assert.rejects(readLocalFolderSnapshot(await inspectLocalFolderRoot(root)), (error: Error) => {
    assert.equal(error.message, FAILURE)
    assert.equal(error.message.includes(parent), false)
    return true
  })
})

test('enforces the shared aggregate text-byte budget', async (t) => {
  const { parent, root } = await fixture()
  t.after(() => cleanup(parent))
  for (let index = 0; index < 3; index++) {
    await writeFile(join(root, `${index}.md`), Buffer.alloc(64 * 1024, 0x78))
  }

  const snapshot = await readLocalFolderSnapshot(await inspectLocalFolderRoot(root))
  assert.equal(snapshot.files.length, 3)
  assert.equal(snapshot.files[0]?.snapshot.text?.length, 64 * 1024)
  assert.equal(snapshot.files[1]?.snapshot.text?.length, 64 * 1024)
  assert.deepEqual(snapshot.files[2]?.snapshot, { omitted: 'budget' })
})

test('rejects a selected root that is itself a symlink', async (t) => {
  const { parent, root } = await fixture()
  t.after(() => cleanup(parent))
  const link = join(parent, 'root-link')
  try {
    await symlink(root, link, 'dir')
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes((error as NodeJS.ErrnoException).code ?? '')) return t.skip('symlinks unavailable')
    throw error
  }

  await assert.rejects(inspectLocalFolderRoot(link), (error: Error) => error.message === FAILURE)
})

test('skips symlink entries without following them', async (t) => {
  const { parent, root } = await fixture()
  t.after(() => cleanup(parent))
  const target = join(parent, 'outside.md')
  await writeFile(target, 'outside')
  try {
    await symlink(target, join(root, 'linked.md'))
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes((error as NodeJS.ErrnoException).code ?? '')) return t.skip('symlinks unavailable')
    throw error
  }

  const snapshot = await readLocalFolderSnapshot(await inspectLocalFolderRoot(root))
  assert.deepEqual(snapshot.files, [])
  assert.equal(await readFile(target, 'utf8'), 'outside')
})

test('rejects a root path replaced after it was pinned', async (t) => {
  const { parent, root } = await fixture()
  t.after(() => cleanup(parent))
  const pinned = await inspectLocalFolderRoot(root)
  const moved = join(parent, 'moved')
  await rename(root, moved)
  await mkdir(root)
  await writeFile(join(root, 'new.md'), 'replacement')

  await assert.rejects(readLocalFolderSnapshot(pinned), (error: Error) => {
    assert.equal(error.message, FAILURE)
    assert.equal(error.message.includes(parent), false)
    return true
  })
})

test('rejects a directory changed after enumeration opens it', async (t) => {
  const { parent, root } = await fixture()
  t.after(() => cleanup(parent))
  await writeFile(join(root, 'a.md'), 'initial')
  const canonicalRoot = await realpath(root)
  let changed = false
  const reader = createLocalFolderReader({
    filesystem: {
      ...fs,
      async opendir(path: string) {
        const directory = await fs.opendir(path)
        if (path === canonicalRoot && !changed) {
          changed = true
          await writeFile(join(root, 'during.md'), 'changed after open')
        }
        return directory
      },
    },
  })
  const pinned = await reader.inspectLocalFolderRoot(root)

  await assert.rejects(reader.readLocalFolderSnapshot(pinned), (error: Error) => error.message === FAILURE)
  assert.equal(changed, true)
})

test('rejects a regular file whose version changes after enumeration', async (t) => {
  const { parent, root } = await fixture()
  t.after(() => cleanup(parent))
  const canonicalRoot = await realpath(root)
  const filePath = join(canonicalRoot, 'notes.md')
  await writeFile(filePath, 'initial')
  let fileStats = 0
  const reader = createLocalFolderReader({
    filesystem: {
      ...fs,
      async lstat(path: string, options?: { bigint?: boolean }) {
        if (path === filePath && ++fileStats === 2) await writeFile(filePath, 'changed version')
        return fs.lstat(path, options)
      },
    },
  })
  const pinned = await reader.inspectLocalFolderRoot(root)

  await assert.rejects(reader.readLocalFolderSnapshot(pinned), (error: Error) => error.message === FAILURE)
  assert.equal(fileStats, 2)
})

test('does not turn a root replacement during a file read into an omitted snapshot', async (t) => {
  const { parent, root } = await fixture()
  t.after(() => cleanup(parent))
  await writeFile(join(root, 'notes.md'), 'original')
  const canonicalRoot = await realpath(root)
  let replaced = false
  const reader = createLocalFolderReader({
    filesystem: {
      ...fs,
      async open(path: string, flags: number) {
        const handle = await fs.open(path, flags)
        if (path === join(canonicalRoot, 'notes.md') && !replaced) {
          replaced = true
          await rename(canonicalRoot, join(parent, 'moved'))
          await mkdir(canonicalRoot)
          await writeFile(join(canonicalRoot, 'notes.md'), 'replacement')
        }
        return handle
      },
    },
  })
  const pinned = await reader.inspectLocalFolderRoot(root)

  await assert.rejects(reader.readLocalFolderSnapshot(pinned), (error: Error) => error.message === FAILURE)
  assert.equal(replaced, true)
})

test('pre-aborted captures issue no content reads', async (t) => {
  const { parent, root } = await fixture()
  t.after(() => cleanup(parent))
  await writeFile(join(root, 'notes.md'), 'text')
  let opened = 0
  const reader = createLocalFolderReader({
    filesystem: {
      ...fs,
      async open(...args: Parameters<typeof fs.open>) {
        opened++
        return fs.open(...args)
      },
    },
  })
  const pinned = await reader.inspectLocalFolderRoot(root)
  const controller = new AbortController()
  controller.abort()

  await assert.rejects(reader.readLocalFolderSnapshot(pinned, { signal: controller.signal }), (error: Error) => {
    assert.equal(error.message, 'The folder capture was cancelled.')
    assert.equal(error.message.includes(parent), false)
    return true
  })
  assert.equal(opened, 0)
})

test('mid-capture abort prevents later files and byte reads', async (t) => {
  const { parent, root } = await fixture()
  t.after(() => cleanup(parent))
  await writeFile(join(root, 'a.md'), 'first')
  await writeFile(join(root, 'b.md'), 'second')
  const canonicalRoot = await realpath(root)
  const controller = new AbortController()
  const opened: string[] = []
  let contentReads = 0
  const reader = createLocalFolderReader({
    filesystem: {
      ...fs,
      async open(path: string, flags: number) {
        opened.push(path)
        const handle = await fs.open(path, flags)
        if (path === join(canonicalRoot, 'a.md')) controller.abort()
        const read = handle.read.bind(handle)
        return {
          stat: handle.stat.bind(handle),
          close: handle.close.bind(handle),
          read: async (...args: Parameters<typeof handle.read>) => {
            contentReads++
            return read(...args)
          },
        }
      },
    },
  })
  const pinned = await reader.inspectLocalFolderRoot(root)

  await assert.rejects(reader.readLocalFolderSnapshot(pinned, { signal: controller.signal }), (error: Error) => {
    assert.equal(error.message, 'The folder capture was cancelled.')
    assert.equal(error.message.includes(parent), false)
    return true
  })
  assert.deepEqual(opened, [join(canonicalRoot, 'a.md')])
  assert.equal(contentReads, 0)
})
