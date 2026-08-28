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

interface Deferred {
  request: UpdateSessionContextStateRequest
  resolve: (value: SessionContextState) => void
  reject: (error: Error) => void
}

function harness() {
  let snapshot: { live: Live; focus: PanelFocus | null } = { live: EMPTY_LIVE, focus: null }
  const statuses: ContextMutationStatus[] = []
  const calls: Deferred[] = []
  const commits: string[] = []
  const controller = createContextMutationController({
    snapshot: () => snapshot,
    mutate: (_sid, request) => new Promise<SessionContextState>((resolve, reject) => {
      calls.push({ request, resolve, reject })
    }),
    commit: (_sid, _before, planned, returned) => {
      snapshot = { live: { ...planned.live, ...returned.workspace }, focus: planned.focus }
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
