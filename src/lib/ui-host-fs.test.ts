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
  assert.deepEqual(await pickUiHostFiles('any', scope), [
    { id: 'notes.md', name: 'notes.md', kind: 'file', text: 'hello', url: undefined },
    { id: 'photo.png', name: 'photo.png', kind: 'photo', text: undefined, url: 'data:image/png;base64,AQID' },
  ])
  assert.deepEqual(calls, ['any'])
})

test('the UI-host adapter maps a native folder to the same source-free artifact scaffold as the web picker', async () => {
  const scope: DesktopBridgeScope = {
    agentCommonsDesktop: {
      context: {
        pickFiles: async () => ({ status: 'cancelled' }),
        pickFolder: async () => ({
          status: 'selected',
          folder: {
            name: 'research',
            files: [
              { name: 'notes.md', sizeBytes: 12 },
              { name: 'photo.png', sizeBytes: 4096 },
            ],
          },
        }),
      },
    },
  }

  assert.deepEqual(await pickUiHostFolder(scope), {
    name: 'research',
    artifacts: [
      { id: 'ui-host:research/notes.md', name: 'notes.md', kind: 'doc', meta: '12 B' },
      { id: 'ui-host:research/photo.png', name: 'photo.png', kind: 'image', meta: '4.0 KB' },
    ],
  })
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
