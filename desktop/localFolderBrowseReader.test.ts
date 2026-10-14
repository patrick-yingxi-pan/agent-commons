import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLocalFolderReader, inspectLocalFolderRoot } from './localFolderReader.mjs'
import { localBrowseFileByteLimit } from '../contract/localFileBrowse.mjs'

const helperEntry = (kind = 'F', sizeBytes = 4, version = 'v1', name = 'notes.txt') => ({ kind, name, sizeBytes, version })

async function fixture(run: (root: any) => Promise<void>) {
  const parent = await mkdtemp(join(tmpdir(), 'local-folder-browse-reader-'))
  const path = join(parent, 'source')
  await mkdir(path)
  try { await run(await inspectLocalFolderRoot(path)) } finally { await rm(parent, { recursive: true, force: true }) }
}

test('folder browsing projects bounded visible metadata without exposing root versions', async () => fixture(async (root) => {
  const listing = { rootVersion: 'private-root-version', visited: 4, directoryCount: 1, entries: [
    helperEntry('D', 0, 'dir-v1', 'nested'), helperEntry('U', 0, 'unsupported-v1', 'nested/link.txt'),
    helperEntry('F', 4, 'file-v1', 'nested/notes.txt'),
  ] }
  const reader = createLocalFolderReader({ listTree: async () => listing })
  assert.deepEqual(await reader.readLocalFolderFiles(root), {
    version: 1, visited: 4, hiddenCount: 1, directoryCount: 1,
    files: [{ path: 'nested/link.txt', kind: 'unsupported' }, { path: 'nested/notes.txt', kind: 'file' }],
  })
}) )

test('selected folder preview is admitted from a fresh tree and reads only one bounded supported file', async () => fixture(async (root) => {
  let listings = 0
  const reads: any[] = []
  const descriptor = { rootVersion: 'private', visited: 1, directoryCount: 0, entries: [helperEntry()] }
  const reader = createLocalFolderReader({
    listTree: async () => { listings++; return descriptor },
    readFile: async (_root: any, path: string, options: any) => {
      reads.push([path, options.maxBytes])
      return { status: 'file', sizeBytes: 4, version: 'v1', bytes: new TextEncoder().encode('text') }
    },
  })
  assert.deepEqual(await reader.readLocalFolderFile(root, { path: 'notes.txt' }), {
    version: 1, path: 'notes.txt', sizeBytes: 4, snapshot: { text: 'text' },
  })
  assert.equal(listings, 2, 'the tree is compared again after the read')
  assert.deepEqual(reads, [['notes.txt', 64 * 1024]])
}))

test('unsupported entries, unsupported names, and oversized selected files never invoke the body reader', async () => fixture(async (root) => {
  const descriptor = { rootVersion: 'private', visited: 1, directoryCount: 0, entries: [helperEntry('U', 8, 'u1', 'image.png')] }
  let reads = 0
  const reader = createLocalFolderReader({ listTree: async () => descriptor, readFile: async () => { reads++; throw new Error('must not read') } })
  assert.deepEqual((await reader.readLocalFolderFile(root, { path: 'image.png' })).snapshot, { omitted: 'unsupported' })

  const tooLarge = { ...descriptor, entries: [helperEntry('F', 64 * 1024 + 1, 'large-v1')] }
  const largeReader = createLocalFolderReader({ listTree: async () => tooLarge, readFile: async () => { reads++; throw new Error('must not read') } })
  assert.deepEqual((await largeReader.readLocalFolderFile(root, { path: 'notes.txt' })).snapshot, { omitted: 'too-large' })
  assert.equal(reads, 0)
}))

test('stale selection and tree changes before/after preview fail closed', async () => fixture(async (root) => {
  let listCalls = 0
  let reads = 0
  const first = { rootVersion: 'v1', visited: 1, directoryCount: 0, entries: [helperEntry()] }
  const changed = { ...first, rootVersion: 'v2' }
  const missing = { rootVersion: 'v1', visited: 0, directoryCount: 0, entries: [] }
  const staleReader = createLocalFolderReader({ listTree: async () => missing, readFile: async () => { reads++; throw new Error() } })
  await assert.rejects(staleReader.readLocalFolderFile(root, { path: 'notes.txt' }), /unavailable or has changed/)
  const changingReader = createLocalFolderReader({ listTree: async () => ++listCalls === 1 ? first : changed,
    readFile: async () => { reads++; return { status: 'file', sizeBytes: 4, version: 'v1', bytes: new TextEncoder().encode('text') } } })
  await assert.rejects(changingReader.readLocalFolderFile(root, { path: 'notes.txt' }), /unavailable or has changed/)
  assert.equal(reads, 1)
}))

test('invalid selection is rejected before native metadata enumeration', async () => fixture(async (root) => {
  let listings = 0
  const reader = createLocalFolderReader({ listTree: async () => { listings++; throw new Error('must not list') } })
  await assert.rejects(reader.readLocalFolderFile(root, { path: '../secret' }), /unavailable or has changed/)
  assert.equal(listings, 0)
}))

test('folder document names list without body reads and only explicit selection transports bounded bytes', async () => fixture(async (root) => {
  const names = ['notes.docx', 'notes.pdf', 'notes.pptx', 'notes.xlsx']
  const bytes = new Uint8Array(65537).fill(255)
  const descriptor = { rootVersion: 'private', visited: names.length, directoryCount: 0,
    entries: names.map(name => helperEntry('F', bytes.byteLength, 'v1', name)) }
  const reads: any[] = []
  const reader = createLocalFolderReader({ listTree: async () => descriptor,
    readFile: async (_root: any, path: string, options: any) => {
      reads.push([path, options.maxBytes])
      return { status: 'file', sizeBytes: bytes.byteLength, version: 'v1', bytes }
    } })
  assert.deepEqual((await reader.readLocalFolderFiles(root)).files, names.map(path => ({ path, kind: 'file' })))
  assert.deepEqual(reads, [])
  for (const path of names) {
    assert.deepEqual((await reader.readLocalFolderFile(root, { path })).snapshot,
      { document: { format: path.split('.').at(-1), bytes } })
  }
  assert.deepEqual(reads, names.map(path => [path, localBrowseFileByteLimit(path)]))
}))

test('oversized or nonregular folder documents are metadata-only omissions', async () => fixture(async (root) => {
  let reads = 0
  for (const kind of ['F', 'U']) {
    const size = localBrowseFileByteLimit('notes.pdf') + 1
    const descriptor = { rootVersion: 'private', visited: 1, directoryCount: 0,
      entries: [helperEntry(kind, size, 'v1', 'notes.pdf')] }
    const reader = createLocalFolderReader({ listTree: async () => descriptor,
      readFile: async () => { reads++; throw new Error('no body read') } })
    assert.deepEqual((await reader.readLocalFolderFile(root, { path: 'notes.pdf' })).snapshot,
      { omitted: kind === 'F' ? 'too-large' : 'unsupported' })
  }
  assert.equal(reads, 0)
}))

test('selected folder document bytes retain file-version, exact-size, whole-tree and cancellation fences', async () => fixture(async (root) => {
  for (const change of ['file', 'size', 'tree', 'abort']) {
    const abort = new AbortController()
    let lists = 0, reads = 0
    const descriptor = { rootVersion: 'private', visited: 1, directoryCount: 0,
      entries: [helperEntry('F', 3, 'v1', 'notes.pdf')] }
    const reader = createLocalFolderReader({
      listTree: async () => ++lists === 2 && change === 'tree' ? { ...descriptor, rootVersion: 'changed' } : descriptor,
      readFile: async () => {
        reads++
        if (change === 'abort') abort.abort()
        return { status: 'file', sizeBytes: change === 'size' ? 4 : 3,
          version: change === 'file' ? 'changed' : 'v1', bytes: new Uint8Array([0, 255, 1]) }
      },
    })
    await assert.rejects(reader.readLocalFolderFile(root, { path: 'notes.pdf' }, { signal: abort.signal }),
      change === 'abort' ? /cancelled/ : /unavailable or has changed/)
    assert.equal(reads, 1, `body read reached the ${change} fence`)
  }
}))
