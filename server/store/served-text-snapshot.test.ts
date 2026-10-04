import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from './index.ts'
import { ConflictError } from '../conflict.ts'
import type { SessionWorkspace } from '../../contract/entities.ts'

const snapshot = {
  version: 1 as const,
  snapshotId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  capturedAt: '2026-10-04T12:00:00.000Z',
  sourceId: 'cloud',
  path: 'notes.md',
  text: 'latest explicitly refreshed copy',
}

test('ordinary context-state updates preserve a served snapshot until the attachment is detached', () => {
  const tenant = `served-snapshot-store-${Date.now()}`
  const session = store.createSession('served snapshot monotonicity', tenant)
  const current: SessionWorkspace = {
    workspaces: [], repos: [], connectors: [],
    attachments: [{
      id: 'cloud::notes.md', label: 'notes.md', kind: 'file',
      source: { id: 'cloud', kind: 'cloud', label: 'Cloud storage' },
      textSnapshot: snapshot,
    }],
  }
  store.updateSessionContextState(session.id, [], current)

  const mismatchedSourceKind: SessionWorkspace = {
    ...current,
    attachments: [{
      id: 'cloud::notes.md', label: 'notes.md', kind: 'file',
      source: { id: 'cloud', kind: 'runner', label: 'Misclassified cloud source' },
    }],
  }
  assert.throws(() => store.updateSessionContextState(session.id, [], mismatchedSourceKind), ConflictError)
  assert.deepEqual(store.sessionWorkspace(session.id).attachments[0]?.textSnapshot, snapshot, 'invalid metadata cannot make the stored snapshot fail its wire contract')

  const staleWorkspace: SessionWorkspace = {
    ...current,
    attachments: [{
      id: 'cloud::notes.md', label: 'renamed in stale view', kind: 'file',
      source: { id: 'cloud', kind: 'cloud', label: 'Cloud storage' },
      previewText: 'old preview, not the captured body',
    }],
  }
  const updated = store.updateSessionContextState(session.id, [], staleWorkspace)
  assert.equal(updated.workspace.attachments[0]?.label, 'renamed in stale view')
  assert.deepEqual(updated.workspace.attachments[0]?.textSnapshot, snapshot)
  assert.equal(updated.workspace.attachments[0]?.previewText, undefined)

  const directWrite = store.setSessionWorkspace(session.id, staleWorkspace)
  assert.deepEqual(directWrite.attachments[0]?.textSnapshot, snapshot, 'the alternate workspace writer also preserves the saved copy')

  const rewoundWorkspace: SessionWorkspace = {
    ...current,
    attachments: [{
      id: 'cloud::notes.md', label: 'notes.md', kind: 'file',
      source: { id: 'cloud', kind: 'cloud', label: 'Cloud storage' },
      textSnapshot: { ...snapshot, snapshotId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', text: 'stale earlier capture' },
    }],
  }
  const directRewind = store.setSessionWorkspace(session.id, rewoundWorkspace)
  assert.deepEqual(directRewind.attachments[0]?.textSnapshot, snapshot, 'the alternate writer cannot replace a receipt with an older client copy')
  const rewound = store.updateSessionContextState(session.id, [], rewoundWorkspace)
  assert.deepEqual(rewound.workspace.attachments[0]?.textSnapshot, snapshot, 'an older client-supplied receipt cannot replace the current copy')

  const attemptedRefreshBypass = store.updateSessionContextState(session.id, [], rewoundWorkspace, {
    refreshAttachmentId: 'cloud::notes.md',
  } as any)
  assert.deepEqual(attemptedRefreshBypass.workspace.attachments[0]?.textSnapshot, snapshot, 'ordinary callers have no refresh bypass')

  const detached = store.updateSessionContextState(session.id, [], { ...staleWorkspace, attachments: [] })
  assert.deepEqual(detached.workspace.attachments, [], 'an explicit detach remains valid')
})
