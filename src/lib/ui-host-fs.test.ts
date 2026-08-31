import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { DesktopBridgeScope } from '../api/desktopCredentials.ts'
import { pickUiHostFiles, pickUiHostFolder, uiHostSupportsPicker } from './uiHostFs.ts'

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
