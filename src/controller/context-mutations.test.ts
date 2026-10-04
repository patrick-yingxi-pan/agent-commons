import { test } from 'node:test'
import assert from 'node:assert/strict'
import { contextFocusAfterCommit, createContextMutationController, type ContextMutationIntent } from './contextMutationsCore.ts'
import { EMPTY_LIVE, type Live } from '../data/liveSession.ts'
import type { ContextMutationStatus } from './conversationCore.ts'
import type {
  PanelFocus,
  SessionContextState,
  UpdateSessionContextStateRequest,
} from '../../contract/index.ts'
import { fsRecentKey } from '../../contract/fs.ts'
import type { Attachment } from '../../contract/entities.ts'
import { mergeServedAttachmentRefresh } from './servedAttachmentRefreshCore.ts'
import { mergeServedFolderRefresh } from './servedFolderRefreshCore.ts'

interface Deferred {
  request: UpdateSessionContextStateRequest
  resolve: (value: SessionContextState) => void
  reject: (error: Error) => void
}

function harness(initialLive: Live = EMPTY_LIVE) {
  let snapshot: { live: Live; focus: PanelFocus | null } = { live: initialLive, focus: null }
  const statuses: ContextMutationStatus[] = []
  const calls: Deferred[] = []
  const commits: string[] = []
  const controller = createContextMutationController({
    snapshot: () => snapshot,
    mutate: (_sid, request) => new Promise<SessionContextState>((resolve, reject) => {
      calls.push({ request, resolve, reject })
    }),
    commit: (_sid, _before, planned, returned) => {
      snapshot = {
        live: planned.attachmentRefresh
          ? mergeServedAttachmentRefresh(snapshot.live, returned, planned.attachmentRefresh)
          : planned.folderRefresh
            ? mergeServedFolderRefresh(snapshot.live, returned, planned.folderRefresh)
            : { ...planned.live, ...returned.workspace },
        focus: planned.focus,
      }
      commits.push(planned.live.connectors.map((connector) => connector.id).join(','))
    },
    setStatus: (_sid, status) => statuses.push(status),
  })
  return { controller, calls, commits, statuses, snapshot: () => snapshot }
}

function addConnector(id: string): ContextMutationIntent {
  return {
    plan: ({ live }) => {
      const connector = { id, label: id, kind: 'connector' as const }
      return {
        live: { ...live, connectors: [...live.connectors, connector] },
        focus: { kind: 'connector', id },
        operations: [{ action: 'attach', context: { id, type: 'connector', label: id } }],
      }
    },
  }
}

const ack = (call: Deferred): void => call.resolve({ contexts: [], workspace: call.request.workspace })
const tick = async (): Promise<void> => {
  await Promise.resolve()
  await Promise.resolve()
}

test('context state is acknowledgement-gated and carries bindings + workspace in one request', async () => {
  const h = harness()
  const outcome = h.controller.enqueue('s1', addConnector('slack'))
  assert.equal(h.calls.length, 1)
  assert.deepEqual(h.calls[0]!.request.operations, [
    { action: 'attach', context: { id: 'slack', type: 'connector', label: 'slack' } },
  ])
  assert.equal(h.snapshot().live.connectors.length, 0, 'no authorization-affecting optimistic panel')
  assert.deepEqual(h.statuses.at(-1), { busy: true, error: null, retryable: false })
  ack(h.calls[0]!)
  await tick()
  assert.equal(await outcome, 'applied')
  assert.deepEqual(h.snapshot().live.connectors.map((connector) => connector.id), ['slack'])
  assert.deepEqual(h.statuses.at(-1), { busy: false, error: null, retryable: false })
})

test('rapid intents serialize per session and the second plans from the first acknowledgement', async () => {
  const h = harness()
  h.controller.enqueue('s1', addConnector('slack'))
  h.controller.enqueue('s1', addConnector('notion'))
  assert.equal(h.calls.length, 1, 'one request is in flight per session')
  ack(h.calls[0]!)
  await tick()
  assert.equal(h.calls.length, 2)
  assert.deepEqual(
    h.calls[1]!.request.workspace.connectors.map((connector) => connector.id),
    ['slack', 'notion'],
    'the queued act rebases on acknowledged live state',
  )
  ack(h.calls[1]!)
  await tick()
  assert.deepEqual(h.commits, ['slack', 'slack,notion'])
})

test('a failed head stays retryable and blocks later intents until explicit retry', async () => {
  const h = harness()
  h.controller.enqueue('s1', addConnector('slack'))
  h.calls[0]!.reject(new Error('offline'))
  await tick()
  assert.equal(h.snapshot().live.connectors.length, 0)
  assert.equal(h.statuses.at(-1)?.retryable, true)
  assert.match(h.statuses.at(-1)?.error ?? '', /offline/)

  h.controller.enqueue('s1', addConnector('notion'))
  assert.equal(h.calls.length, 1, 'later intent cannot skip the failed head')
  h.controller.dismiss('s1')
  assert.equal(h.calls.length, 1, 'generic context intents do not expose the refresh-only dismissal escape')
  assert.equal(h.statuses.at(-1)?.dismissible, undefined)
  h.controller.retry('s1')
  assert.equal(h.calls.length, 2)
  ack(h.calls[1]!)
  await tick()
  assert.equal(h.calls.length, 3, 'the queued second intent follows the recovered head')
  ack(h.calls[2]!)
  await tick()
  assert.deepEqual(h.snapshot().live.connectors.map((connector) => connector.id), ['slack', 'notion'])
})

test('clearing on account switch drops a late acknowledgement', async () => {
  const h = harness()
  const outcome = h.controller.enqueue('s1', addConnector('slack'))
  h.controller.clearAll()
  assert.equal(await outcome, 'discarded', 'the waiting UI is released without claiming success')
  ack(h.calls[0]!)
  await tick()
  assert.equal(h.snapshot().live.connectors.length, 0)
  assert.deepEqual(h.commits, [])
})

test('refresh retries keep one request id; Dismiss reads truth before releasing later FIFO intent', async () => {
  const attachmentId = fsRecentKey('cloud', 'notes.md')
  const currentAttachment: Attachment = {
    id: attachmentId, label: 'notes.md', kind: 'file',
    source: { id: 'cloud', kind: 'cloud', label: 'Cloud storage' },
  }
  const h = harness({ ...EMPTY_LIVE, attachments: [currentAttachment] })
  const requestIds: string[] = []
  const refreshAttempts: Array<{ resolve: (value: SessionContextState) => void; reject: (error: Error) => void }> = []
  let resolveReconcile: ((value: SessionContextState) => void) | undefined
  const intent: ContextMutationIntent = {
    plan: ({ live, focus }) => ({
      live, focus, operations: [],
      attachmentRefresh: {
        attachmentId: 'cloud::notes.md',
        expectedSnapshotId: null,
        requestId: '44444444-4444-4444-8444-444444444444',
      },
    }),
    mutate: (_snapshot, plan) => new Promise<SessionContextState>((resolve, reject) => {
      requestIds.push(plan.attachmentRefresh!.requestId)
      refreshAttempts.push({ resolve, reject })
    }),
    reconcile: (_snapshot, signal) => new Promise<SessionContextState>((resolve) => {
      assert.equal(signal.aborted, false)
      resolveReconcile = () => resolve({ contexts: [], workspace: {
        workspaces: [], repos: [], connectors: [],
        attachments: [{ ...currentAttachment, textSnapshot: {
          version: 1,
          snapshotId: '44444444-4444-4444-8444-444444444444',
          capturedAt: '2026-01-01T00:00:00.000Z',
          sourceId: 'cloud',
          path: 'notes.md',
          text: 'saved after the lost response',
        } }],
      } })
    }),
  }
  const head = h.controller.enqueue('s1', intent)
  refreshAttempts[0]!.reject(new Error('conflict'))
  await tick()
  h.controller.retry('s1')
  assert.equal(requestIds.length, 2)
  assert.equal(requestIds[0], requestIds[1], 'Retry preserves one logical snapshot request id')
  refreshAttempts[1]!.reject(new Error('permission changed'))
  await tick()

  const later = h.controller.enqueue('s1', addConnector('slack'))
  h.controller.dismiss('s1')
  await tick()
  assert.equal(h.calls.length, 0, 'later context work remains behind reconciliation')
  assert.equal(h.statuses.at(-1)?.busy, true)
  assert.equal(h.statuses.at(-1)?.reconciling, true)
  resolveReconcile!({ contexts: [], workspace: { workspaces: [], repos: [], connectors: [], attachments: [] } })
  await tick()

  assert.equal(await head, 'discarded', 'dismissal releases the failed refresh without calling it applied')
  assert.equal(h.snapshot().live.attachments[0]?.textSnapshot?.snapshotId, requestIds[0], 'the canonical read reveals a refresh that committed before its response was lost')
  assert.equal(h.calls.length, 1, 'later FIFO intent starts only after authoritative read acknowledgement')
  ack(h.calls[0]!)
  await tick()
  assert.equal(await later, 'applied')
})

test('failed refresh reconciliation retains its hold and account clearing aborts/fences a late read', async () => {
  const h = harness()
  const reconciliations: Array<{
    resolve: (value: SessionContextState) => void
    reject: (error: Error) => void
    signal: AbortSignal
  }> = []
  const intent: ContextMutationIntent = {
    plan: ({ live, focus }) => ({
      live, focus, operations: [],
      attachmentRefresh: { attachmentId: 'cloud::notes.md', expectedSnapshotId: null, requestId: '55555555-5555-4555-8555-555555555555' },
    }),
    mutate: () => Promise.reject(new Error('conflict')),
    reconcile: (_snapshot, signal) => new Promise<SessionContextState>((resolve, reject) => {
      reconciliations.push({ resolve, reject, signal })
    }),
  }
  const outcome = h.controller.enqueue('s1', intent)
  await tick()
  h.controller.dismiss('s1')
  await tick()
  assert.equal(h.statuses.at(-1)?.reconciling, true)
  reconciliations[0]!.reject(new Error('read offline'))
  await tick()
  assert.match(h.statuses.at(-1)?.error ?? '', /read offline/)
  assert.equal(h.statuses.at(-1)?.retryable, true)
  assert.equal(h.statuses.at(-1)?.dismissible, true, 'the failed head remains held and may reconcile again')
  h.controller.dismiss('s1')
  await tick()
  const late = reconciliations[1]!
  assert.equal(late.signal.aborted, false)
  assert.equal(h.calls.length, 0)
  h.controller.clearAll()
  assert.equal(await outcome, 'discarded')
  assert.equal(late.signal.aborted, true, 'account clearing aborts active reconciliation')
  late.resolve({ contexts: [], workspace: { workspaces: [], repos: [], connectors: [], attachments: [] } })
  await tick()
  assert.deepEqual(h.commits, [], 'a late read after account clearing cannot publish')
})

test('folder save retry keeps one request id; read-only dismissal commits canonical folder snapshot before queued work', async () => {
  const folderId = fsRecentKey('cloud', 'docs')
  const currentWorkspace = {
    id: 'ws', label: 'Workspace',
    folders: [{ id: folderId, label: 'Docs' }],
    artifacts: [{ id: 'legacy-doc', name: 'notes.md', kind: 'doc' as const, meta: '', source: { id: folderId, label: 'Docs' } }],
  }
  const h = harness({ ...EMPTY_LIVE, workspaces: [currentWorkspace] })
  const attempts: Array<{ requestId: string; reject: (error: Error) => void }> = []
  const savedId = '66666666-6666-4666-8666-666666666666'
  const captured = {
    version: 1 as const, snapshotId: savedId, capturedAt: '2026-10-04T12:00:00.000Z',
    sourceId: 'cloud', path: 'docs', files: [{ name: 'notes.md', sizeBytes: 10, snapshot: { text: 'saved copy' } }],
  }
  const intent: ContextMutationIntent = {
    plan: ({ live, focus }) => ({
      live, focus, operations: [],
      folderRefresh: { folderId, expectedSnapshotId: null, requestId: '77777777-7777-4777-8777-777777777777' },
    }),
    mutate: (_snapshot, plan) => new Promise<SessionContextState>((_resolve, reject) => {
      attempts.push({ requestId: plan.folderRefresh!.requestId, reject })
    }),
    reconcile: async () => ({ contexts: [], workspace: {
      workspaces: [{ ...currentWorkspace, folders: [{ id: folderId, label: 'Docs', snapshot: captured }], artifacts: [] }],
      repos: [], connectors: [], attachments: [],
    } }),
  }
  const outcome = h.controller.enqueue('s-folder', intent)
  attempts[0]!.reject(new Error('response lost'))
  await tick()
  h.controller.retry('s-folder')
  assert.equal(attempts[1]!.requestId, attempts[0]!.requestId)
  attempts[1]!.reject(new Error('response lost again'))
  await tick()

  const later = h.controller.enqueue('s-folder', addConnector('slack'))
  h.controller.dismiss('s-folder')
  await tick()
  assert.equal(h.calls.length, 0, 'the next context mutation waits for canonical reconciliation')
  assert.equal(await outcome, 'discarded')
  assert.equal(h.snapshot().live.workspaces[0]?.folders?.[0]?.snapshot?.snapshotId, savedId)
  assert.equal(h.snapshot().live.workspaces[0]?.artifacts.length, 0, 'saved files are projected from snapshot.files, not legacy artifact rows')
  assert.equal(h.calls.length, 1)
  ack(h.calls[0]!)
  await tick()
  assert.equal(await later, 'applied')
})

test('an own SSE echo of the planned focus is still remembered; a later user focus wins', () => {
  const live = {
    ...EMPTY_LIVE,
    connectors: [
      { id: 'slack', label: 'Slack', kind: 'connector' },
      { id: 'notion', label: 'Notion', kind: 'connector' },
    ],
  } as Live
  assert.deepEqual(
    contextFocusAfterCommit(
      { kind: 'connector', id: 'slack' },
      null,
      { kind: 'connector', id: 'slack' },
      live,
    ),
    { focus: { kind: 'connector', id: 'slack' }, remember: true },
  )
  assert.deepEqual(
    contextFocusAfterCommit(
      { kind: 'connector', id: 'notion' },
      null,
      { kind: 'connector', id: 'slack' },
      live,
    ),
    { focus: { kind: 'connector', id: 'notion' }, remember: false },
  )
})
