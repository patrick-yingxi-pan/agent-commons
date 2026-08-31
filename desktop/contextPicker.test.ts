import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_FOLDER_ENTRIES,
  MAX_IMAGE_PREVIEW_BYTES,
  MAX_PICKED_FILES,
  createNativeContextPicker,
  listTopLevelEntriesBounded,
} from './contextPicker.mjs'

const regularFile = (size: number) => ({ isFile: () => true, size })

test('native file selection returns bounded previews without paths or handles', async () => {
  const dialogs: unknown[] = []
  const picker = createNativeContextPicker({
    showOpenDialog: async (_owner: unknown, options: unknown) => {
      dialogs.push(options)
      return { canceled: false, filePaths: ['/private/work/notes.md', '/private/work/photo.png'] }
    },
    inspect: async (path: string) => regularFile(path.endsWith('.png') ? 3 : 5),
    readBytes: async (path: string) => Buffer.from(path.endsWith('.png') ? [1, 2, 3] : 'hello'),
  })

  const result = await picker.pickFiles({}, 'any')
  assert.deepEqual(result, {
    status: 'selected',
    files: [
      { name: 'notes.md', kind: 'file', sizeBytes: 5, text: 'hello' },
      { name: 'photo.png', kind: 'photo', sizeBytes: 3, previewDataUrl: 'data:image/png;base64,AQID' },
    ],
  })
  assert.equal(JSON.stringify(result).includes('/private/work'), false)
  assert.deepEqual(dialogs, [{ title: 'Add files', properties: ['openFile', 'multiSelections'] }])
})

test('native file selection cancels cleanly and rejects invalid, oversized, or excessive selections before reading', async () => {
  let filePaths: string[] = []
  let reads = 0
  const picker = createNativeContextPicker({
    showOpenDialog: async () => ({ canceled: filePaths.length === 0, filePaths }),
    inspect: async () => regularFile(MAX_IMAGE_PREVIEW_BYTES + 1),
    readBytes: async () => { reads += 1; return Buffer.alloc(0) },
  })

  assert.deepEqual(await picker.pickFiles({}, 'any'), { status: 'cancelled' })
  assert.deepEqual(await picker.pickFiles({}, 'video'), { status: 'rejected', reason: 'invalid-request' })
  filePaths = Array.from({ length: MAX_PICKED_FILES + 1 }, (_, index) => `/private/${index}.txt`)
  assert.deepEqual(await picker.pickFiles({}, 'any'), { status: 'rejected', reason: 'too-many-files' })
  filePaths = ['/private/large.png']
  assert.deepEqual(await picker.pickFiles({}, 'image'), { status: 'rejected', reason: 'image-too-large' })
  assert.equal(reads, 0)
})

test('a selected file growing after stat still cannot cross the preview bound', async () => {
  const picker = createNativeContextPicker({
    showOpenDialog: async () => ({ canceled: false, filePaths: ['/private/growing.png'] }),
    inspect: async () => regularFile(1),
    readBytes: async () => Buffer.alloc(MAX_IMAGE_PREVIEW_BYTES + 1),
  })
  assert.deepEqual(await picker.pickFiles({}, 'image'), { status: 'rejected', reason: 'image-too-large' })
})

test('native folder selection lists only bounded top-level regular files and returns no root path', async () => {
  const picker = createNativeContextPicker({
    showOpenDialog: async (_owner: unknown, options: unknown) => {
      assert.deepEqual(options, { title: 'Add folder', properties: ['openDirectory'] })
      return { canceled: false, filePaths: ['/private/work/research'] }
    },
    listDirectory: async (...args: unknown[]) => {
      assert.deepEqual(args, ['/private/work/research'])
      return [
        { name: 'notes.md', isFile: () => true },
        { name: 'photo.png', isFile: () => true },
        { name: 'nested', isFile: () => false },
        { name: 'linked-secret', isFile: () => false },
      ]
    },
    inspect: async (path: string) => regularFile(path.endsWith('.png') ? 4096 : 12),
  })

  const result = await picker.pickFolder({})
  assert.deepEqual(result, {
    status: 'selected',
    folder: {
      name: 'research',
      files: [
        { name: 'notes.md', sizeBytes: 12 },
        { name: 'photo.png', sizeBytes: 4096 },
      ],
    },
  })
  assert.equal(JSON.stringify(result).includes('/private/work'), false)
})

test('native folder selection refuses an unbounded listing and converts read failures to a stable result', async () => {
  let entries = Array.from({ length: MAX_FOLDER_ENTRIES + 1 }, (_, index) => ({ name: `${index}.txt`, isFile: () => true }))
  const picker = createNativeContextPicker({
    showOpenDialog: async () => ({ canceled: false, filePaths: ['/private/work'] }),
    listDirectory: async () => entries,
    inspect: async () => regularFile(1),
  })
  assert.deepEqual(await picker.pickFolder({}), { status: 'rejected', reason: 'too-many-folder-entries' })

  entries = [{ name: 'gone.txt', isFile: () => true }]
  const broken = createNativeContextPicker({
    showOpenDialog: async () => ({ canceled: false, filePaths: ['/private/work'] }),
    listDirectory: async () => entries,
    inspect: async () => { throw new Error('/private/work/gone.txt') },
  })
  assert.deepEqual(await broken.pickFolder({}), { status: 'rejected', reason: 'unreadable' })
})

test('the default directory reader stops before materializing an unbounded listing', async () => {
  let yielded = 0
  let closed = 0
  const directory = {
    async *[Symbol.asyncIterator]() {
      while (yielded < MAX_FOLDER_ENTRIES + 100) {
        yielded += 1
        yield { name: `${yielded}`, isFile: () => false }
      }
    },
    async close() { closed += 1 },
  }
  const entries = await listTopLevelEntriesBounded('/private/work', async () => directory)
  assert.equal(entries.length, MAX_FOLDER_ENTRIES + 1)
  assert.equal(yielded, MAX_FOLDER_ENTRIES + 1)
  assert.equal(closed, 1)
})
