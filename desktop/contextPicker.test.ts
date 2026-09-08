import { test } from 'node:test'
import { mkdtemp, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import {
  MAX_FOLDER_ENTRIES,
  MAX_IMAGE_PREVIEW_BYTES,
  MAX_PICKED_FILES,
  MAX_TEXT_PREVIEW_BYTES,
  createNativeContextPicker,
  listTopLevelEntriesBounded,
} from './contextPicker.mjs'
import { MAX_PDF_FILE_BYTES, MAX_PDF_SELECTION_BYTES } from '../contract/pdfImport.mjs'
import { MAX_DOCX_FILE_BYTES, MAX_DOCX_SELECTION_BYTES } from '../contract/docxImport.mjs'

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

test('native text selection recognizes source files and common extensionless files, but omits unsafe content', async () => {
  const payloads = new Map<string, Uint8Array>([
    ['/private/example.py', Buffer.from('print("python")')],
    ['/private/example.ts', Buffer.from('const answer: number = 42')],
    ['/private/example.tsx', Buffer.from('export const View = () => null')],
    ['/private/example.js', Buffer.from('export default 42')],
    ['/private/example.rs', Buffer.from('fn main() {}')],
    ['/private/Makefile', Buffer.from('all:\n\t@true\n')],
    ['/private/Dockerfile', Buffer.from('FROM scratch\n')],
    ['/private/LICENSE', Buffer.from('Permission is hereby granted.')],
    ['/private/.gitignore', Buffer.from('node_modules\n')],
    ['/private/exact.txt', Buffer.from('exact existing text')],
    ['/private/empty.md', Buffer.alloc(0)],
    ['/private/binary.txt', Uint8Array.from([0x61, 0x00, 0x62])],
    ['/private/invalid.txt', Uint8Array.from([0xc3, 0x28])],
    ['/private/large.txt', Buffer.alloc(256 * 1024 + 1, 0x78)],
    ['/private/manual.pdf', Buffer.from('not model text')],
    ['/private/archive.zip', Buffer.from('not model text')],
  ])
  const paths = [...payloads.keys()]
  const picker = createNativeContextPicker({
    showOpenDialog: async () => ({ canceled: false, filePaths: paths }),
    inspect: async (path: string) => regularFile(payloads.get(path)?.byteLength ?? 0),
    readBytes: async (path: string) => payloads.get(path) ?? new Uint8Array(),
  })

  const result = await picker.pickFiles({}, 'any')
  assert.equal(result.status, 'selected')
  const files = new Map(result.files.map((file) => [file.name, file]))
  const expectedText = new Map([
    ['example.py', 'print("python")'],
    ['example.ts', 'const answer: number = 42'],
    ['example.tsx', 'export const View = () => null'],
    ['example.js', 'export default 42'],
    ['example.rs', 'fn main() {}'],
    ['Makefile', 'all:\n\t@true\n'],
    ['Dockerfile', 'FROM scratch\n'],
    ['LICENSE', 'Permission is hereby granted.'],
    ['.gitignore', 'node_modules\n'],
  ])
  for (const [name, text] of expectedText) {
    assert.equal(files.get(name)?.text, text, `${name} should carry its exact text`)
  }
  assert.equal(files.get('exact.txt')?.text, 'exact existing text')
  assert.equal(files.get('empty.md')?.text, '')
  for (const name of ['binary.txt', 'invalid.txt', 'large.txt', 'manual.pdf', 'archive.zip']) {
    assert.equal(files.get(name)?.text, undefined, `${name} must not carry fabricated text`)
  }
  assert.ok(files.get('manual.pdf')?.pdfBytes instanceof Uint8Array)
  assert.equal(files.get('manual.pdf')?.pdfFailure, undefined)
})

test('native PDF selection enforces the per-file bound and reports stat/read mismatches', async () => {
  let reads = 0
  const picker = createNativeContextPicker({
    showOpenDialog: async () => ({ canceled: false, filePaths: ['/private/oversized.pdf'] }),
    inspect: async () => regularFile(MAX_PDF_FILE_BYTES + 1),
    readBytes: async (_path: string, maxBytes: number) => {
      reads += 1
      assert.equal(maxBytes, MAX_PDF_FILE_BYTES)
      return Buffer.alloc(MAX_PDF_FILE_BYTES)
    },
  })
  const result = await picker.pickFiles({}, 'any')
  assert.deepEqual(result, { status: 'selected', files: [{ name: 'oversized.pdf', kind: 'file', sizeBytes: MAX_PDF_FILE_BYTES + 1, pdfFailure: 'file-too-large' }] })
  assert.equal(reads, 0)

  const mismatch = createNativeContextPicker({
    showOpenDialog: async () => ({ canceled: false, filePaths: ['/private/mismatch.pdf'] }),
    inspect: async () => regularFile(10),
    readBytes: async () => Buffer.alloc(9),
  })
  const mismatchResult = await mismatch.pickFiles({}, 'any')
  assert.deepEqual(mismatchResult, {
    status: 'selected',
    files: [{ name: 'mismatch.pdf', kind: 'file', sizeBytes: 10, pdfFailure: 'invalid' }],
  })
})

test('native PDF selection bounds aggregate bytes before reading the next file', async () => {
  const paths = ['/private/one.pdf', '/private/two.pdf', '/private/three.pdf', '/private/four.pdf']
  const reads: string[] = []
  const picker = createNativeContextPicker({
    showOpenDialog: async () => ({ canceled: false, filePaths: paths }),
    inspect: async () => regularFile(MAX_PDF_FILE_BYTES),
    readBytes: async (path: string) => { reads.push(path); return Buffer.alloc(MAX_PDF_FILE_BYTES) },
  })
  const result = await picker.pickFiles({}, 'any')
  assert.equal(result.status, 'selected')
  assert.equal(result.files.length, 4)
  assert.deepEqual(reads, paths.slice(0, 3))
  assert.equal(result.files.slice(0, 3).reduce((sum, file) => sum + file.pdfBytes.byteLength, 0), MAX_PDF_SELECTION_BYTES)
  assert.equal(result.files[3].pdfFailure, 'selection-limit')
  assert.equal(result.files[3].pdfBytes, undefined)
})

test('native DOCX selection transfers bounded archive bytes and shares the PDF aggregate budget', async () => {
  const paths = ['/private/report.pdf', '/private/brief.docx', '/private/third.docx', '/private/over-budget.docx']
  const reads: string[] = []
  const picker = createNativeContextPicker({
    showOpenDialog: async () => ({ canceled: false, filePaths: paths }),
    inspect: async (path: string) => regularFile(path.endsWith('.pdf') ? MAX_PDF_FILE_BYTES : MAX_DOCX_FILE_BYTES),
    readBytes: async (path: string, maxBytes: number) => {
      reads.push(path)
      assert.equal(maxBytes, path.endsWith('.pdf') ? MAX_PDF_FILE_BYTES : MAX_DOCX_FILE_BYTES)
      return Buffer.alloc(maxBytes)
    },
  })
  const result = await picker.pickFiles({}, 'any')
  assert.equal(result.status, 'selected')
  assert.deepEqual(reads, paths.slice(0, 3))
  assert.ok(result.files[1]?.docxBytes instanceof Uint8Array)
  assert.ok(result.files[2]?.docxBytes instanceof Uint8Array)
  assert.equal(result.files[3]?.docxFailure, 'selection-limit')
  assert.equal(result.files[3]?.docxBytes, undefined)
  assert.equal(MAX_PDF_FILE_BYTES + MAX_DOCX_FILE_BYTES <= MAX_DOCX_SELECTION_BYTES, true)
})

test('native text and image intake reject short reads instead of persisting truncated previews', async () => {
  const textPicker = createNativeContextPicker({
    showOpenDialog: async () => ({ canceled: false, filePaths: ['/private/short.txt'] }),
    inspect: async () => regularFile(5),
    readBytes: async () => Buffer.from('four'),
  })
  assert.deepEqual(await textPicker.pickFiles({}, 'any'), {
    status: 'selected',
    files: [{ name: 'short.txt', kind: 'file', sizeBytes: 5 }],
  })
  const imagePicker = createNativeContextPicker({
    showOpenDialog: async () => ({ canceled: false, filePaths: ['/private/short.png'] }),
    inspect: async () => regularFile(4),
    readBytes: async () => Buffer.from([1, 2, 3]),
  })
  assert.deepEqual(await imagePicker.pickFiles({}, 'any'), { status: 'rejected', reason: 'unreadable' })
})

test('native text selection omits bytes that exceed the read budget after stat', async () => {
  const picker = createNativeContextPicker({
    showOpenDialog: async () => ({ canceled: false, filePaths: ['/private/growing.py'] }),
    inspect: async () => regularFile(1),
    readBytes: async (_path: string, maxBytes: number) => {
      assert.equal(maxBytes, MAX_TEXT_PREVIEW_BYTES)
      return Buffer.alloc(MAX_TEXT_PREVIEW_BYTES + 1, 0x78)
    },
  })
  const result = await picker.pickFiles({}, 'any')
  assert.deepEqual(result, {
    status: 'selected',
    files: [{ name: 'growing.py', kind: 'file', sizeBytes: 1 }],
  })
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
    readBytes: async (path: string) => {
      assert.equal(path, '/private/work/research/notes.md')
      return Buffer.from('folder notes')
    },
  })

  const result = await picker.pickFolder({})
  assert.deepEqual(result, {
    status: 'selected',
    folder: {
      name: 'research',
      files: [
        { name: 'notes.md', sizeBytes: 12, snapshot: { text: 'folder notes' } },
        { name: 'photo.png', sizeBytes: 4096, snapshot: { omitted: 'unsupported' } },
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

test('native folder snapshots omit dotfiles and do not read unsupported or budget-exhausted entries', async () => {
  const reads: string[] = []
  const large = Buffer.alloc(64 * 1024, 0x78)
  const picker = createNativeContextPicker({
    showOpenDialog: async () => ({ canceled: false, filePaths: ['/private/work'] }),
    listDirectory: async () => [
      { name: '.env', isFile: () => true },
      { name: '01.ts', isFile: () => true },
      { name: '02.ts', isFile: () => true },
      { name: '03.ts', isFile: () => true },
      { name: 'photo.png', isFile: () => true },
    ],
    inspect: async (path: string) => regularFile(path.endsWith('.png') ? 4 : path.includes('03') ? 1 : 64 * 1024),
    readBytes: async (path: string) => {
      reads.push(path)
      return path.includes('03') ? Buffer.from('x') : large
    },
  })
  const result = await picker.pickFolder({})
  assert.equal(result.status, 'selected')
  assert.deepEqual(result.folder.files.map((file) => [file.name, file.snapshot]), [
    ['01.ts', { text: 'x'.repeat(64 * 1024) }],
    ['02.ts', { text: 'x'.repeat(64 * 1024) }],
    ['03.ts', { omitted: 'budget' }],
    ['photo.png', { omitted: 'unsupported' }],
  ])
  assert.deepEqual(reads, ['/private/work/01.ts', '/private/work/02.ts'])
})

test('native folder snapshots reject a file replaced by a symlink without exposing outside bytes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-commons-folder-'))
  const inside = join(root, 'notes.ts')
  const outside = join(root, 'outside-secret.txt')
  const moved = join(root, 'notes-original.ts')
  await writeFile(inside, 'inside body')
  await writeFile(outside, 'outside secret body')
  try {
    const picker = createNativeContextPicker({
      showOpenDialog: async () => ({ canceled: false, filePaths: [root] }),
      listDirectory: async () => [
        { name: '.hidden.ts', isFile: () => true },
        { name: 'notes.ts', isFile: () => true },
        { name: 'link.ts', isFile: () => false },
      ],
      inspect: async (path: string) => {
        const details = regularFile(path.endsWith('notes.ts') ? 11 : 0)
        if (path.endsWith('notes.ts')) {
          await rename(path, moved)
          await symlink(outside, path)
        }
        return details
      },
    })
    const result = await picker.pickFolder({})
    assert.deepEqual(result, {
      status: 'selected',
      folder: { name: root.split('/').at(-1), files: [{ name: 'notes.ts', sizeBytes: 11, snapshot: { omitted: 'unreadable' } }] },
    })
    assert.equal(JSON.stringify(result).includes('outside secret body'), false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
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
