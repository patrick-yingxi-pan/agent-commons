import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { DesktopBridgeScope } from '../api/desktopCredentials.ts'
import { pickUiHostFiles, pickUiHostFolder, readDroppedFiles, uiHostSupportsPicker } from './uiHostFs.ts'

const dropped = (files: File[]): FileList => files as unknown as FileList

test('the UI-host adapter prefers Electron selected-file previews without learning a path', async () => {
  const calls: unknown[] = []
  const scope: DesktopBridgeScope = {
    agentCommonsDesktop: {
      context: {
        pickFiles: async (accept) => {
          calls.push(accept)
          return {
            status: 'selected',
            files: [
              { name: 'notes.md', kind: 'file', sizeBytes: 5, text: 'hello' },
              { name: 'photo.png', kind: 'photo', sizeBytes: 3, previewDataUrl: 'data:image/png;base64,AQID' },
            ],
          }
        },
        pickFolder: async () => ({ status: 'cancelled' }),
      },
    },
  }

  assert.equal(uiHostSupportsPicker(), false)
  assert.equal(uiHostSupportsPicker(scope), true)
  const selected = await pickUiHostFiles('any', scope)
  assert.equal(selected.length, 2)
  assert.equal(selected[0]?.name, 'notes.md')
  assert.equal(selected[0]?.kind, 'file')
  assert.equal(selected[0]?.text, 'hello')
  assert.equal(selected[1]?.name, 'photo.png')
  assert.equal(selected[1]?.kind, 'photo')
  assert.equal(selected[1]?.url, 'data:image/png;base64,AQID')
  assert.ok(selected[0]?.id && selected[0].id !== selected[0].name)
  assert.ok(selected[1]?.id && selected[1].id !== selected[1].name)
  assert.notEqual(selected[0]?.id, selected[1]?.id)
  assert.deepEqual(calls, ['any'])
})

test('native picks keep same-basename files distinct across bodies and subsequent selections', async () => {
  let pick = 0
  const scope: DesktopBridgeScope = {
    agentCommonsDesktop: {
      context: {
        pickFiles: async () => ({
          status: 'selected' as const,
          files: [{ name: 'notes.txt', kind: 'file' as const, sizeBytes: 5, text: pick++ === 0 ? 'first' : 'second' }],
        }),
        pickFolder: async () => ({ status: 'cancelled' as const }),
      },
    },
  }
  const first = await pickUiHostFiles('any', scope)
  const second = await pickUiHostFiles('any', scope)
  assert.equal(first[0]?.name, 'notes.txt')
  assert.equal(second[0]?.name, 'notes.txt')
  assert.equal(first[0]?.text, 'first')
  assert.equal(second[0]?.text, 'second')
  assert.ok(first[0]?.id && first[0].id !== first[0].name)
  assert.ok(second[0]?.id && second[0].id !== second[0].name)
  assert.notEqual(first[0]?.id, second[0]?.id)
})

test('native folder snapshots retain real text and opaque identities', async () => {
  const scope: DesktopBridgeScope = {
    agentCommonsDesktop: {
      context: {
        pickFiles: async () => ({ status: 'cancelled' }),
        pickFolder: async () => ({
          status: 'selected',
          folder: {
            name: 'research',
            files: [
              { name: 'notes.md', sizeBytes: 12, snapshot: { text: 'hello' } },
              { name: 'photo.png', sizeBytes: 4096, snapshot: { omitted: 'unsupported' } },
            ],
          },
        }),
      },
    },
  }

  const picked = await pickUiHostFolder(scope)
  assert.equal(picked?.name, 'research')
  assert.ok(picked?.id && picked.id !== 'research')
  assert.equal(picked?.artifacts[0]?.localSnapshot?.text, 'hello')
  assert.equal(picked?.artifacts[1]?.localSnapshot?.omitted, 'unsupported')
  assert.ok(picked?.artifacts.every((a) => a.id && !a.id.includes('research/')))
})

test('native folder snapshots keep same-name entries independent', async () => {
  const scope: DesktopBridgeScope = {
    agentCommonsDesktop: { context: {
      pickFiles: async () => ({ status: 'cancelled' as const }),
      pickFolder: async () => ({ status: 'selected' as const, folder: { name: 'repo', files: [
        { name: 'notes.md', sizeBytes: 5, snapshot: { text: 'one' } },
        { name: 'notes.md', sizeBytes: 6, snapshot: { text: 'two' } },
      ] } }),
    } },
  }
  const picked = await pickUiHostFolder(scope)
  assert.deepEqual(picked?.artifacts.map((a) => a.localSnapshot?.text), ['one', 'two'])
  assert.notEqual(picked?.artifacts[0]?.id, picked?.artifacts[1]?.id)
})

test('browser folder selection snapshots only visible top-level files', async () => {
  const reads: string[] = []
  const make = (name: string, path: string, body: string) => ({
    name,
    size: body.length,
    webkitRelativePath: path,
    arrayBuffer: async () => {
      reads.push(path)
      return new TextEncoder().encode(body).buffer
    },
  }) as unknown as File
  const files = [
    make('notes.md', 'repo/notes.md', 'actual notes'),
    make('nested.md', 'repo/src/nested.md', 'must not be read'),
    make('.hidden.md', 'repo/.hidden.md', 'must not be read'),
  ]
  const previous = globalThis.document
  globalThis.document = {
    createElement: () => {
      const input = {
        type: '', multiple: false, accept: '', files,
        click: () => queueMicrotask(() => input.onchange?.()),
        onchange: undefined as (() => void) | undefined,
        addEventListener: () => {},
      }
      return input
    },
  } as unknown as Document
  try {
    const picked = await pickUiHostFolder({})
    assert.equal(picked?.artifacts.length, 1)
    assert.equal(picked?.artifacts[0]?.name, 'notes.md')
    assert.equal(picked?.artifacts[0]?.localSnapshot?.text, 'actual notes')
    assert.deepEqual(reads, ['repo/notes.md'])
    assert.ok(picked?.artifacts[0]?.id && picked.id !== picked.artifacts[0].id)
  } finally {
    globalThis.document = previous
  }
})

test('browser folder selection never reads a nested-only folder', async () => {
  let reads = 0
  const nested = {
    name: 'nested.md', size: 6, webkitRelativePath: 'repo/src/nested.md',
    arrayBuffer: async () => { reads += 1; return new TextEncoder().encode('nested').buffer },
  } as unknown as File
  const previous = globalThis.document
  globalThis.document = {
    createElement: () => {
      const input = {
        type: '', multiple: false, accept: '', files: [nested],
        click: () => queueMicrotask(() => input.onchange?.()),
        onchange: undefined as (() => void) | undefined,
        addEventListener: () => {},
      }
      return input
    },
  } as unknown as Document
  try {
    const picked = await pickUiHostFolder({})
    assert.equal(picked?.artifacts.length, 0)
    assert.equal(reads, 0)
  } finally {
    globalThis.document = previous
  }
})

test('browser folder entry cap rejects before reading any file', async () => {
  let reads = 0
  const files = Array.from({ length: 501 }, (_, i) => ({
    name: `file-${i}.txt`, size: 1, webkitRelativePath: `repo/file-${i}.txt`,
    arrayBuffer: async () => { reads += 1; return new Uint8Array([97]).buffer },
  })) as unknown as File[]
  const previous = globalThis.document
  globalThis.document = {
    createElement: () => {
      const input = {
        type: '', multiple: false, accept: '', files,
        click: () => queueMicrotask(() => input.onchange?.()),
        onchange: undefined as (() => void) | undefined,
        addEventListener: () => {},
      }
      return input
    },
  } as unknown as Document
  try {
    await assert.rejects(() => pickUiHostFolder({}), /no more than 500/)
    assert.equal(reads, 0)
  } finally {
    globalThis.document = previous
  }
})

test('native refusal becomes concise recoverable picker copy and cancellation is a no-op', async () => {
  const scope: DesktopBridgeScope = {
    agentCommonsDesktop: {
      context: {
        pickFiles: async () => ({ status: 'rejected', reason: 'too-many-files' }),
        pickFolder: async () => ({ status: 'cancelled' }),
      },
    },
  }
  await assert.rejects(() => pickUiHostFiles('any', scope), /no more than 24 files/)
  assert.equal(await pickUiHostFolder(scope), null)
})

test('browser dropped files preserve safe local text and omit binary, invalid, oversized, unsupported, and image content', async () => {
  const files = await readDroppedFiles(dropped([
    new File(['print("python")'], 'example.py', { type: 'text/plain' }),
    new File(['const answer = 42'], 'example.ts', { type: 'text/plain' }),
    new File(['export const View = () => null'], 'example.tsx', { type: 'text/plain' }),
    new File(['export default 42'], 'example.js', { type: 'text/plain' }),
    new File(['fn main() {}'], 'example.rs', { type: 'text/plain' }),
    new File(['all:\n\t@true\n'], 'Makefile', { type: 'text/plain' }),
    new File(['FROM scratch\n'], 'Dockerfile', { type: 'text/plain' }),
    new File(['Permission is hereby granted.'], 'LICENSE', { type: 'text/plain' }),
    new File(['node_modules\n'], '.gitignore', { type: 'text/plain' }),
    new File(['exact existing text'], 'exact.txt', { type: 'text/plain' }),
    new File([], 'empty.md', { type: 'text/markdown' }),
    new File([Uint8Array.from([0x61, 0x00, 0x62])], 'binary.txt', { type: 'text/plain' }),
    new File([Uint8Array.from([0xc3, 0x28])], 'invalid.txt', { type: 'text/plain' }),
    new File([new Uint8Array(256 * 1024 + 1)], 'large.txt', { type: 'text/plain' }),
    new File(['not model text'], 'manual.pdf', { type: 'application/pdf' }),
    new File(['not model text'], 'archive.zip', { type: 'application/zip' }),
    new File([Uint8Array.from([1, 2, 3])], 'photo.png', { type: 'image/png' }),
  ]))
  const byName = new Map(files.map((file) => [file.name, file]))
  const expectedText = new Map([
    ['example.py', 'print("python")'],
    ['example.ts', 'const answer = 42'],
    ['example.tsx', 'export const View = () => null'],
    ['example.js', 'export default 42'],
    ['example.rs', 'fn main() {}'],
    ['Makefile', 'all:\n\t@true\n'],
    ['Dockerfile', 'FROM scratch\n'],
    ['LICENSE', 'Permission is hereby granted.'],
    ['.gitignore', 'node_modules\n'],
  ])
  for (const [name, text] of expectedText) {
    assert.equal(byName.get(name)?.text, text, `${name} should carry its exact text`)
  }
  assert.equal(byName.get('exact.txt')?.text, 'exact existing text')
  assert.equal(byName.get('empty.md')?.text, '')
  for (const name of ['binary.txt', 'invalid.txt', 'large.txt', 'manual.pdf', 'archive.zip']) {
    assert.equal(byName.get(name)?.text, undefined, `${name} must not carry fabricated text`)
  }
  assert.equal(byName.get('photo.png')?.kind, 'photo')
  assert.equal(byName.get('photo.png')?.text, undefined)
})

test('browser same-basename text files retain bodies while receiving distinct opaque IDs', async () => {
  const selected = await readDroppedFiles(dropped([
    new File(['first body'], 'notes.md', { type: 'text/markdown' }),
    new File(['second body'], 'notes.md', { type: 'text/markdown' }),
  ]))
  assert.equal(selected.length, 2)
  assert.deepEqual(selected.map((file) => file.name), ['notes.md', 'notes.md'])
  assert.deepEqual(selected.map((file) => file.text), ['first body', 'second body'])
  assert.ok(selected.every((file) => file.id && file.id !== file.name))
  assert.notEqual(selected[0]?.id, selected[1]?.id)
})

test('browser same-basename photos and later re-picks receive distinct IDs and revocable URLs', async () => {
  const first = await readDroppedFiles(dropped([
    new File([Uint8Array.from([1, 2, 3])], 'photo.png', { type: 'image/png' }),
    new File([Uint8Array.from([4, 5, 6])], 'photo.png', { type: 'image/png' }),
  ]))
  const second = await readDroppedFiles(dropped([
    new File([Uint8Array.from([7, 8, 9])], 'photo.png', { type: 'image/png' }),
  ]))
  try {
    assert.deepEqual(first.map((file) => file.name), ['photo.png', 'photo.png'])
    assert.deepEqual(second.map((file) => file.name), ['photo.png'])
    assert.ok(first.every((file) => file.kind === 'photo' && file.id && file.id !== file.name && file.url))
    assert.ok(second[0]?.kind === 'photo' && second[0].id !== second[0].name && second[0].url)
    assert.notEqual(first[0]?.id, first[1]?.id)
    assert.notEqual(first[0]?.id, second[0]?.id)
    assert.notEqual(first[1]?.id, second[0]?.id)
  } finally {
    for (const file of [...first, ...second]) if (file.url?.startsWith('blob:')) URL.revokeObjectURL(file.url)
  }
})
