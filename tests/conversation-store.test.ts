/** Locking tests: the per-session conversation store (universal split Phase 1,
 *  docs/design/universal-split-workspace.md §2.2) — the keyed decomposition of
 *  the singleton controller's session half. Drives the PURE core
 *  (src/controller/conversationCore.ts) with a scripted fake transport, so the
 *  keyed isolation, the epoch staleness, the per-session send chains, and the
 *  draft-adoption move are locked without a DOM or a fetch. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createConversationStore,
  type ConversationTransport,
  type TurnHandlers,
} from '../src/controller/conversationCore.ts'
import type { Live } from '../src/data/liveSession.ts'
import type { Message } from '../contract/index.ts'

const EMPTY: Live = { messages: [], workspaces: [], repos: [], connectors: [], attachments: [] }
const empty = () => EMPTY
const user = (id: string, content: string): Message => ({ id, role: 'user', content })
const shell = (id: string): Message => ({ id, role: 'assistant', content: '' })

/** A scripted transport: each sendMessage call parks until the test drives its
 *  handlers, so streams can interleave deterministically. */
function fakeTransport() {
  const sends: Array<{ sessionId: string; text: string; handlers: TurnHandlers; finish: () => void }> = []
  const reattaches: Array<{ sessionId: string; turnId: string; handlers: TurnHandlers; finish: () => void }> = []
  const cancelled: Array<{ sessionId: string; turnId: string }> = []
  const settledFor: string[] = []
  const transport: ConversationTransport = {
    sendMessage: (sessionId, text, handlers) =>
      new Promise<void>((resolve) => {
        sends.push({ sessionId, text, handlers, finish: resolve })
      }),
    reattachTurn: (sessionId, turnId, _from, handlers) =>
      new Promise<void>((resolve) => {
        reattaches.push({ sessionId, turnId, handlers, finish: resolve })
      }),
    cancelTurn: (sessionId, turnId) => {
      cancelled.push({ sessionId, turnId })
      return Promise.resolve()
    },
    onTurnSettled: (sessionId) => {
      settledFor.push(sessionId)
    },
  }
  return { transport, sends, reattaches, cancelled, settledFor }
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0))

test('keyed isolation: two sessions stream concurrently into their own entries', async () => {
  const { transport, sends } = fakeTransport()
  const store = createConversationStore(transport, empty)
  store.setLive('a', (l) => ({ ...l, messages: [user('ua', 'hi a')] }))
  store.setLive('b', (l) => ({ ...l, messages: [user('ub', 'hi b')] }))
  void store.sendTurn('a', 'hi a')
  void store.sendTurn('b', 'hi b')
  await tick()
  assert.equal(sends.length, 2, 'different sessions run CONCURRENTLY (no global chain)')

  sends[0]!.handlers.onStart?.('ma', shell('ma'), 'turn-a')
  sends[1]!.handlers.onStart?.('mb', shell('mb'), 'turn-b')
  sends[0]!.handlers.onDelta?.('ma', 'alpha')
  sends[1]!.handlers.onDelta?.('mb', 'beta')
  assert.equal(store.get('a').live.messages.at(-1)?.content, 'alpha')
  assert.equal(store.get('b').live.messages.at(-1)?.content, 'beta')
  assert.deepEqual(store.get('a').liveTurn, { sessionId: 'a', turnId: 'turn-a' })
  assert.deepEqual(store.get('b').liveTurn, { sessionId: 'b', turnId: 'turn-b' })
})

test('per-session serialization: a second send to the SAME session queues behind the first', async () => {
  const { transport, sends } = fakeTransport()
  const store = createConversationStore(transport, empty)
  void store.sendTurn('s', 'one')
  void store.sendTurn('s', 'two')
  await tick()
  assert.equal(sends.length, 1, 'the second send waits for the first turn')
  sends[0]!.handlers.onEnd?.(shell('m1'))
  sends[0]!.finish()
  await tick()
  await tick()
  assert.equal(sends.length, 2, 'the queued send dispatches once the first settles')
  assert.equal(sends[1]!.text, 'two')
})

test('epoch staleness: a reset stales in-flight streams; navigation elsewhere does NOT', async () => {
  const { transport, sends } = fakeTransport()
  const store = createConversationStore(transport, empty)
  void store.sendTurn('s', 'q')
  await tick()
  sends[0]!.handlers.onStart?.('m', shell('m'))
  sends[0]!.handlers.onDelta?.('m', 'landed ')
  // "Navigating away" is nothing to the store — the stream keeps landing.
  sends[0]!.handlers.onDelta?.('m', 'still landing')
  assert.equal(store.get('s').live.messages.at(-1)?.content, 'landed still landing')
  // A RESET of this same session (select-time reload) stales the stream.
  store.reset('s', EMPTY)
  sends[0]!.handlers.onDelta?.('m', ' NOT this')
  sends[0]!.handlers.onEnd?.(shell('m'))
  assert.equal(store.get('s').live.messages.length, 0, 'post-reset deltas are refused')
  assert.equal(store.get('s').busy, false)
})

test('reconcile replaces live WITHOUT staling the stream, and refuses after a reset', async () => {
  const { transport, sends } = fakeTransport()
  const store = createConversationStore(transport, empty)
  store.reset('s', { ...EMPTY, messages: [user('u1', 'q')] })
  const since = store.epoch('s')
  void store.sendTurn('s', 'q')
  await tick()
  sends[0]!.handlers.onStart?.('m', shell('m'))
  // The server read lands mid-stream (the old same-runId semantics): applied…
  assert.equal(store.reconcile('s', since, { ...EMPTY, messages: [user('u1', 'q'), shell('m')] }), true)
  // …and the stream keeps appending onto the reconciled state.
  sends[0]!.handlers.onDelta?.('m', 'after reconcile')
  assert.equal(store.get('s').live.messages.at(-1)?.content, 'after reconcile')
  // A reset invalidates the captured epoch — the late reconcile is refused.
  store.reset('s', EMPTY)
  assert.equal(store.reconcile('s', since, { ...EMPTY, messages: [user('zombie', 'x')] }), false)
  assert.equal(store.get('s').live.messages.length, 0)
})

test('adopt moves the draft entry under the real id — once; a blank recreation cannot clobber', () => {
  const { transport } = fakeTransport()
  const store = createConversationStore(transport, empty)
  store.update('draft', (s) => ({ ...s, typing: true, busy: true, live: { ...EMPTY, messages: [user('u1', 'first')] } }))
  store.adopt('draft', 'real-1')
  assert.equal(store.get('real-1').live.messages[0]?.content, 'first', 'the optimistic turn moved')
  assert.equal(store.get('real-1').typing, true, 'the flags moved with it')
  assert.equal(store.get('draft').live.messages.length, 0, 'the draft slot is blank again')
  // The coalesced second send's adopt (the draft entry lazily recreated blank)
  // must NOT overwrite the real entry.
  store.adopt('draft', 'real-1')
  assert.equal(store.get('real-1').live.messages[0]?.content, 'first')
})

test('dispatchTurn (the pane path) appends the optimistic user turn, flags, and streams — in one call', async () => {
  const { transport, sends } = fakeTransport()
  const store = createConversationStore(transport, empty)
  void store.dispatchTurn('s', 'from a pane')
  assert.equal(store.get('s').live.messages.at(-1)?.content, 'from a pane', 'the user turn rendered at dispatch')
  assert.equal(store.get('s').typing, true)
  assert.equal(store.get('s').busy, true)
  await tick()
  assert.equal(sends[0]?.text, 'from a pane')
  // Two panes dispatching to DIFFERENT sessions run concurrently (the multi-pane requirement).
  void store.dispatchTurn('t', 'other pane')
  await tick()
  assert.equal(sends.length, 2)
  // …and their optimistic user messages got distinct ids (no same-millisecond collision).
  assert.notEqual(store.get('s').live.messages.at(-1)?.id, store.get('t').live.messages.at(-1)?.id)
})

test('a failed send lands the refusal copy in the entry and settles the flags', async () => {
  const store = createConversationStore(
    {
      sendMessage: () => Promise.reject(new Error('Your delegated session is still answering another turn — try again when it finishes.')),
      reattachTurn: () => Promise.resolve(),
      cancelTurn: () => Promise.resolve(),
    },
    empty,
  )
  store.patch('s', { typing: true, busy: true })
  await store.sendTurn('s', 'q')
  assert.equal(store.get('s').busy, false)
  assert.match(store.get('s').sendFailure ?? '', /delegated session/)
})

test('escalations hold per session; holdEscalation never replaces a held prompt', () => {
  const { transport } = fakeTransport()
  const store = createConversationStore(transport, empty)
  const held = { messageId: 'm1', escalation: { kind: 'project', project: { id: 'p', name: 'P', description: '' }, fileSession: true } as never }
  store.holdEscalation('s', held)
  store.holdEscalation('s', { ...held, messageId: 'm2' })
  assert.equal(store.get('s').pendingEscalation?.messageId, 'm1', 'the first held prompt wins (C28)')
  assert.equal(store.get('other').pendingEscalation, null, 'held per session')
})

test('stop cancels the entry’s server-owned turn; reattach resumes and settles; usage refresh fires per settle', async () => {
  const { transport, reattaches, cancelled, settledFor } = fakeTransport()
  const store = createConversationStore(transport, empty)
  store.reattach('s', 'turn-9')
  await tick()
  assert.equal(store.get('s').busy, true)
  assert.deepEqual(store.get('s').liveTurn, { sessionId: 's', turnId: 'turn-9' })
  store.stop('s')
  assert.deepEqual(cancelled, [{ sessionId: 's', turnId: 'turn-9' }])
  reattaches[0]!.handlers.onEnd?.(shell('m'))
  reattaches[0]!.finish()
  await tick()
  await tick()
  assert.equal(store.get('s').busy, false, 'the stream end settles the flags')
  assert.deepEqual(settledFor, ['s'], 'the settle hook (usage refresh) fired for the session')
})

test('subscribe notifies on the entry’s changes only; clearAll drops every conversation', () => {
  const { transport } = fakeTransport()
  const store = createConversationStore(transport, empty)
  let aNotified = 0
  let bNotified = 0
  const offA = store.subscribe('a', () => (aNotified += 1))
  store.subscribe('b', () => (bNotified += 1))
  store.patch('a', { typing: true })
  assert.equal(aNotified, 1)
  assert.equal(bNotified, 0, 'keyed notification — no cross-session re-render')
  const before = store.get('b')
  assert.equal(store.get('b'), before, 'snapshots are identity-stable between mutations')
  store.clearAll()
  assert.equal(store.get('a').typing, false, 'account switch drops every entry')
  offA()
  store.patch('a', { typing: true })
  assert.equal(aNotified, 2, 'clearAll notified; the unsubscribed listener stops counting')
})
