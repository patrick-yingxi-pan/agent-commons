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
} from './conversationCore.ts'
import type { Live } from '../data/liveSession.ts'
import type { Message } from '../../contract/index.ts'

const EMPTY: Live = { messages: [], workspaces: [], repos: [], connectors: [], attachments: [] }
const empty = () => EMPTY
const user = (id: string, content: string): Message => ({ id, role: 'user', content })
const shell = (id: string): Message => ({ id, role: 'assistant', content: '' })

/** A scripted transport: each sendMessage call parks until the test drives its
 *  handlers, so streams can interleave deterministically. */
function fakeTransport() {
  const sends: Array<{
    sessionId: string
    text: string
    handlers: TurnHandlers
    options: { idempotencyKey: string; retryLastUser: boolean }
    finish: () => void
    fail: (error: Error) => void
  }> = []
  const reattaches: Array<{
    sessionId: string
    turnId: string
    handlers: TurnHandlers
    finish: () => void
    fail: (error: Error) => void
  }> = []
  const cancelled: Array<{ sessionId: string; turnId: string }> = []
  const settledFor: string[] = []
  const transport: ConversationTransport = {
    sendMessage: (sessionId, text, handlers, options) =>
      new Promise<void>((resolve, reject) => {
        sends.push({ sessionId, text, handlers, options, finish: resolve, fail: reject })
      }),
    reattachTurn: (sessionId, turnId, _from, handlers) =>
      new Promise<void>((resolve, reject) => {
        reattaches.push({ sessionId, turnId, handlers, finish: resolve, fail: reject })
      }),
    isStaleReattachError: (error) =>
      typeof error === 'object' && error !== null && 'code' in error && error.code === 'live_turn_unavailable',
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

test('draft Agent/model intent shares the conversation entry and clears only on reset or account disposal', () => {
  const store = createConversationStore(fakeTransport().transport, empty)
  assert.equal(store.get('draft').draftBinding, null)
  const binding = { agentId: 'custom', providerId: 'provider', modelId: 'model' }
  store.patch('draft', { draftBinding: binding })
  assert.deepEqual(store.get('draft').draftBinding, binding, 'another pane reads the same entry')
  store.setFocus('draft', null)
  assert.deepEqual(store.get('draft').draftBinding, binding)
  store.reset('draft', EMPTY)
  assert.equal(store.get('draft').draftBinding, null)
  store.patch('draft', { draftBinding: binding })
  store.clearAll()
  assert.equal(store.get('draft').draftBinding, null)
})

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

test('a pre-send draft context refusal preserves one retryable user row and reset/disposal epochs fence late failure', () => {
  const { transport } = fakeTransport()
  const store = createConversationStore(transport, empty)
  store.setLive('draft', (live) => ({ ...live, messages: [user('prior-user', 'earlier'), shell('prior-answer'), user('draft-user', 'send this')] }))
  store.update('draft', (state) => ({ ...state, busy: true, typing: true }))
  const since = store.epoch('draft')

  store.failPendingSend('draft', since, 'send this', 'Couldn’t save the queued context. Source unavailable.')

  const failed = store.get('draft')
  assert.equal(failed.busy, false)
  assert.equal(failed.typing, false)
  assert.equal(failed.sendFailure, 'Couldn’t save the queued context. Source unavailable.')
  assert.deepEqual(failed.retryableSend, {
    text: 'send this',
    idempotencyKey: failed.retryableSend?.idempotencyKey,
    userMessageId: 'draft-user',
    priorMessageId: 'prior-answer',
  })
  assert.match(failed.retryableSend?.idempotencyKey ?? '', /^[0-9a-f-]{36}$/i)
  assert.equal(store.beginRetry('draft')?.userMessageId, 'draft-user', 'Retry keeps the same optimistic user row')
  assert.equal(store.get('draft').sendFailure, null)

  store.update('draft', (state) => ({ ...state, busy: true, typing: true }))
  const beforeReset = store.epoch('draft')
  store.reset('draft', EMPTY)
  store.failPendingSend('draft', beforeReset, 'send this', 'stale reset failure')
  assert.equal(store.get('draft').sendFailure, null, 'reset invalidates pending failure publication')
  assert.equal(store.get('draft').retryableSend, null)

  store.setLive('draft', (live) => ({ ...live, messages: [user('new-user', 'new account')] }))
  store.update('draft', (state) => ({ ...state, busy: true, typing: true }))
  const beforeDisposal = store.epoch('draft')
  store.clearAll()
  store.failPendingSend('draft', beforeDisposal, 'new account', 'stale account failure')
  assert.equal(store.get('draft').sendFailure, null, 'account disposal invalidates pending failure publication')
  assert.equal(store.get('draft').retryableSend, null)
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

test('pane read receipt rejects an older context projection after a local context commit', () => {
  const { transport } = fakeTransport()
  const store = createConversationStore(transport, empty)
  store.reset('s', EMPTY)
  const receipt = store.beginPaneRead('s')
  const attached = [{ id: 'new-workspace' }] as unknown as Live['workspaces']
  store.setLive('s', { ...EMPTY, messages: [user('local', 'keep me')], workspaces: attached })

  assert.equal(store.isPaneReadCurrent('s', receipt), false)
  assert.equal(
    store.reconcile('s', receipt, { ...EMPTY, messages: [user('stale', 'old response')] }),
    false,
    'a read begun before the context change cannot roll it back',
  )
  assert.equal(store.get('s').live.workspaces, attached)
  assert.deepEqual(store.get('s').live.messages.map((message) => message.id), ['local'])
})

test('only the latest issued pane read may reconcile, even when responses arrive out of order', () => {
  const { transport } = fakeTransport()
  const store = createConversationStore(transport, empty)
  store.reset('s', EMPTY)
  const olderRead = store.beginPaneRead('s')
  const newerRead = store.beginPaneRead('s')

  assert.equal(store.reconcile('s', olderRead, { ...EMPTY, messages: [user('old', 'older read')] }), false)
  assert.equal(store.reconcile('s', newerRead, { ...EMPTY, messages: [user('new', 'newer read')] }), true)
  assert.equal(store.isPaneReadLatest('s', newerRead), true, 'an accepted projection may advance context generation without retiring its follow-up')
  assert.deepEqual(store.get('s').live.messages.map((message) => message.id), ['new'])
})

test('pane read receipt is fenced by reset, account disposal, and receipt-only ids', () => {
  const { transport } = fakeTransport()
  const store = createConversationStore(transport, empty)
  store.reset('s', EMPTY)
  const beforeReset = store.beginPaneRead('s')
  store.reset('s', { ...EMPTY, messages: [user('fresh', 'fresh')] })
  assert.equal(store.isPaneReadCurrent('s', beforeReset), false)

  const neverLoaded = store.beginPaneRead('receipt-only')
  store.clearAll()
  assert.equal(store.isPaneReadCurrent('receipt-only', neverLoaded), false)
  assert.ok(store.epoch('receipt-only') > neverLoaded.epoch, 'clearAll invalidates ids with no prior state')
})

test('adopting into a session invalidates its pane reads without bumping its stream epoch', () => {
  const { transport } = fakeTransport()
  const store = createConversationStore(transport, empty)
  store.reset('target', EMPTY)
  const targetEpoch = store.epoch('target')
  const receipt = store.beginPaneRead('target')
  store.update('draft', (s) => ({ ...s, composerText: 'draft intent' }))

  store.adopt('draft', 'target')
  assert.equal(store.epoch('target'), targetEpoch, 'adoption does not stale streams already dispatched under target')
  assert.equal(store.isPaneReadCurrent('target', receipt), false)
})

test('pane reads survive transcript-only stream writes and older-page pagination', () => {
  const { transport } = fakeTransport()
  const store = createConversationStore(transport, empty)
  store.reset('s', EMPTY)
  store.reconcile('s', store.epoch('s'), { ...EMPTY, messages: [user('u3', 'three'), user('u4', 'four')] }, {
    olderCursor: 'before-u3',
    olderTokens: 2,
  })
  const receipt = store.beginPaneRead('s')
  store.setLive('s', { ...EMPTY, messages: [user('u3', 'three'), user('u4', 'four streamed')] })
  assert.equal(store.isPaneReadCurrent('s', receipt), true, 'transcript deltas do not change context generation')
  store.prependHistory(
    's',
    store.epoch('s'),
    { ...EMPTY, messages: [user('u1', 'one'), user('u2', 'two'), user('u3', 'three')] },
    { olderCursor: 'before-u1', olderTokens: 7 },
  )
  assert.equal(store.isPaneReadCurrent('s', receipt), true, 'pagination does not stale a tail refresh')
  assert.equal(store.reconcile('s', receipt, { ...EMPTY, messages: [user('u4', 'four updated'), user('u5', 'five')] }, {
    olderCursor: 'before-u4',
    olderTokens: 1,
  }), true)
  assert.deepEqual(store.get('s').live.messages.map((message) => message.id), ['u1', 'u2', 'u3', 'u4', 'u5'])
  assert.equal(store.get('s').live.messages.find((message) => message.id === 'u4')?.content, 'four updated')
  assert.equal(store.get('s').history.olderCursor, 'before-u1', 'tail reconcile retains the loaded older cursor')
  assert.equal(store.get('s').history.olderTokens, 7)

  const latestReply = store.beginPaneRead('s')
  assert.equal(store.reconcile('s', latestReply, { ...EMPTY, messages: [user('u5', 'five'), user('u6', 'six')] }, {
    olderCursor: 'before-u5',
    olderTokens: 3,
  }), true)
  assert.equal(store.isPaneReadCurrent('s', receipt), false, 'a newer reply retires the previous receipt')
})

test('paged history prepends without duplicates and a live reconcile preserves the loaded prefix', () => {
  const { transport } = fakeTransport()
  const store = createConversationStore(transport, empty)
  const tail = { ...EMPTY, messages: [user('u3', 'three'), user('u4', 'four')] }
  store.reset('s', EMPTY)
  const since = store.epoch('s')
  assert.equal(
    store.reconcile('s', since, tail, { olderCursor: 'before-u3', olderTokens: 2 }),
    true,
  )
  assert.equal(store.get('s').history.olderCursor, 'before-u3')
  assert.equal(store.get('s').history.olderTokens, 2)

  store.setHistoryLoading('s', true)
  assert.equal(store.get('s').history.loading, true)
  store.prependHistory(
    's',
    since,
    { ...EMPTY, messages: [user('u1', 'one'), user('u2', 'two'), user('u3', 'three')] },
    { olderCursor: null, olderTokens: 0 },
  )
  assert.deepEqual(store.get('s').live.messages.map((m) => m.id), ['u1', 'u2', 'u3', 'u4'])
  assert.equal(store.get('s').history.olderCursor, null)
  assert.equal(store.get('s').history.loading, false)

  // A push brings an authoritative newest tail. Since this client already has
  // the whole prefix, the refresh must update/append the tail without throwing
  // the older messages away.
  const refreshed = { ...EMPTY, messages: [user('u4', 'four updated'), user('u5', 'five')] }
  assert.equal(store.reconcile('s', since, refreshed, { olderCursor: 'before-u4', olderTokens: 3 }), true)
  assert.deepEqual(store.get('s').live.messages.map((m) => m.id), ['u1', 'u2', 'u3', 'u4', 'u5'])
  assert.equal(store.get('s').live.messages.find((m) => m.id === 'u4')?.content, 'four updated')
  assert.equal(store.get('s').history.olderCursor, null, 'the already-loaded prefix stays complete')
  assert.equal(store.get('s').history.olderTokens, 0)
})

test('an older page captured before reset is refused by the session epoch fence', () => {
  const { transport } = fakeTransport()
  const store = createConversationStore(transport, empty)
  store.reset('s', { ...EMPTY, messages: [user('tail', 'tail')] })
  const staleEpoch = store.epoch('s')
  store.reset('s', { ...EMPTY, messages: [user('fresh', 'fresh')] })
  assert.equal(
    store.prependHistory(
      's',
      staleEpoch,
      { ...EMPTY, messages: [user('old', 'old')] },
      { olderCursor: null, olderTokens: 0 },
    ),
    false,
  )
  assert.deepEqual(store.get('s').live.messages.map((message) => message.id), ['fresh'])
})

test('a complete paged reconcile resets stale loaded history after remote compaction', () => {
  const { transport } = fakeTransport()
  const store = createConversationStore(transport, empty)
  store.reset('s', EMPTY)
  const since = store.epoch('s')
  store.reconcile('s', since, { ...EMPTY, messages: [user('old', 'old'), user('tail', 'tail')] }, {
    olderCursor: null,
    olderTokens: 0,
  })
  const compacted: Message = { id: 'summary', role: 'assistant', content: 'summary', compactedFrom: 2 }
  store.reconcile('s', since, { ...EMPTY, messages: [compacted] }, { olderCursor: null, olderTokens: 0 })
  assert.deepEqual(store.get('s').live.messages.map((m) => m.id), ['summary'])
})

test('a newest-page reconcile with no overlap resets instead of inventing a contiguous history', () => {
  const { transport } = fakeTransport()
  const store = createConversationStore(transport, empty)
  store.reset('s', EMPTY)
  const since = store.epoch('s')
  store.reconcile('s', since, { ...EMPTY, messages: [user('old-1', 'old'), user('old-2', 'old')] }, {
    olderCursor: 'before-old-1',
    olderTokens: 4,
  })
  store.reconcile('s', since, { ...EMPTY, messages: [user('new-1', 'new'), user('new-2', 'new')] }, {
    olderCursor: 'before-new-1',
    olderTokens: 80,
  })
  assert.deepEqual(store.get('s').live.messages.map((m) => m.id), ['new-1', 'new-2'])
  assert.equal(store.get('s').history.olderCursor, 'before-new-1')
  assert.equal(store.get('s').history.olderTokens, 80)
})

test('clearAll BUMPS epochs (monotonic), staling an in-flight stream that captured since===0 — the account-switch fence', async () => {
  const { transport, sends } = fakeTransport()
  const store = createConversationStore(transport, empty)
  // A stream on a session whose epoch was never bumped captures since === 0 (the
  // just-adopted-draft case: adopt leaves the target epoch untouched).
  assert.equal(store.epoch('s'), 0)
  void store.sendTurn('s', 'q')
  await tick()
  sends[0]!.handlers.onStart?.('m', shell('m'))
  sends[0]!.handlers.onDelta?.('m', 'from old account')
  assert.equal(store.get('s').live.messages.at(-1)?.content, 'from old account')
  // Account switch: clearAll must BUMP (not clear) the epoch, or it would rewind
  // to 0 and the outgoing account's still-running stream would keep writing into
  // the NEW account's store.
  store.clearAll()
  assert.ok(store.epoch('s') > 0, 'the epoch advanced, it was not rewound to 0')
  sends[0]!.handlers.onDelta?.('m', ' MUST NOT land')
  assert.equal(store.get('s').live.messages.length, 0, "the old account's post-switch deltas are refused")
})

test('reconciled is the AUTHORITY latch: false until a server read lands; reset clears it (live prune gates on it)', () => {
  const { transport } = fakeTransport()
  const store = createConversationStore(transport, empty)
  store.reset('s', EMPTY)
  assert.equal(store.get('s').reconciled, false, 'a mirror-seeded entry is a transient unknown, never prune-worthy')
  assert.equal(store.reconcile('s', store.epoch('s'), EMPTY), true)
  assert.equal(store.get('s').reconciled, true, 'a server read makes an absence definitive')
  // An optimistic write keeps the authority (setLive is not a re-seed)…
  store.setLive('s', { ...EMPTY, messages: [user('u1', 'q')] })
  assert.equal(store.get('s').reconciled, true)
  // …but a select-time reset re-seeds from the mirror: authority drops.
  store.reset('s', EMPTY)
  assert.equal(store.get('s').reconciled, false)
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

test('a send cannot overtake pending or failed context intent and can retry after acknowledgement', async () => {
  for (const contextMutation of [
    { busy: true, error: null, retryable: false },
    { busy: false, error: 'Lost detach acknowledgement', retryable: true },
  ]) {
    const { transport, sends } = fakeTransport()
    const store = createConversationStore(transport, empty)
    // Cover the same-tick gap after UI dispatch but before the transport runs.
    const attempted = store.dispatchTurn('s', 'Send only after detach')
    store.patch('s', { contextMutation })
    await tick()
    assert.equal(sends.length, 0, 'unacknowledged input changes cannot reach the model')
    await attempted
    assert.equal(store.get('s').busy, false)
    assert.match(store.get('s').sendFailure ?? '', /context update/)
    assert.equal(store.get('s').retryableSend?.text, 'Send only after detach', 'the blocked intent is retained, not lost')
    store.patch('s', { contextMutation: { busy: false, error: null, retryable: false } })
    const retried = store.retryTurn('s')
    await tick()
    assert.equal(sends.length, 1)
    assert.equal(sends[0]?.text, 'Send only after detach')
    assert.equal(store.get('s').live.messages.filter((message) => message.role === 'user').length, 1)
    sends[0]!.finish()
    await retried
  }
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

test('retry retransmits one logical send in place with the same idempotency key', async () => {
  const { transport, sends } = fakeTransport()
  const store = createConversationStore(transport, empty)
  const first = store.dispatchTurn('s', 'keep this once')
  await tick()
  const firstKey = sends[0]!.options.idempotencyKey
  sends[0]!.handlers.onStart?.('partial-a', shell('partial-a'), 'turn-a')
  sends[0]!.handlers.onDelta?.('partial-a', 'half an answer')
  sends[0]!.fail(new Error('connection dropped'))
  await first

  assert.deepEqual(
    store.get('s').live.messages.map((message) => [message.role, message.content]),
    [['user', 'keep this once'], ['assistant', 'half an answer']],
    'the failed view may contain a partial assistant shell',
  )
  assert.equal(store.get('s').retryableSend?.idempotencyKey, firstKey)

  const retry = store.retryTurn('s')
  await tick()
  assert.deepEqual(
    store.get('s').live.messages.map((message) => [message.role, message.content]),
    [['user', 'keep this once']],
    'retry removes the unpersisted partial and never appends the user input again',
  )
  assert.equal(sends[1]!.options.idempotencyKey, firstKey, 'transport retransmission keeps the original key')
  assert.equal(sends[1]!.options.retryLastUser, true, 'the server may reuse an already-persisted user tail')

  // A completed-key replay carries only message.end (no start/deltas). It must
  // still restore the authoritative reply after the partial was removed.
  sends[1]!.handlers.onEnd?.({ id: 'answer-a', role: 'assistant', content: 'complete answer' })
  sends[1]!.finish()
  await retry
  assert.deepEqual(
    store.get('s').live.messages.map((message) => [message.role, message.content]),
    [['user', 'keep this once'], ['assistant', 'complete answer']],
  )
  assert.equal(store.get('s').retryableSend, null)
  assert.equal(store.get('s').sendFailure, null)
})

test('an orphaned server user row retries after reload without a second optimistic prompt', async () => {
  const { transport, sends } = fakeTransport()
  const store = createConversationStore(transport, empty)
  store.reset('s', { ...EMPTY, messages: [user('server-user', 'resume this')] })

  const retry = store.retryTurn('s')
  await tick()
  assert.equal(store.get('s').live.messages.length, 1, 'the existing server row is the retry target')
  assert.equal(sends[0]!.text, 'resume this')
  assert.equal(sends[0]!.options.retryLastUser, true)
  assert.ok(sends[0]!.options.idempotencyKey, 'the recovered operation gets a new stable key')
  sends[0]!.handlers.onEnd?.({ id: 'answer-b', role: 'assistant', content: 'resumed' })
  sends[0]!.finish()
  await retry
  assert.deepEqual(store.get('s').live.messages.map((message) => message.role), ['user', 'assistant'])
})

test('authoritative reconcile completes a lost response but preserves a send that never persisted', async () => {
  const { transport, sends } = fakeTransport()
  const store = createConversationStore(transport, empty)
  store.reset('s', { ...EMPTY, messages: [user('prior', 'already answered'), shell('prior-answer')] })

  const completedSend = store.dispatchTurn('s', 'server finished this')
  await tick()
  sends[0]!.fail(new Error('response lost'))
  await completedSend
  assert.equal(store.get('s').retryableSend?.priorMessageId, 'prior-answer')

  store.reconcile('s', store.epoch('s'), {
    ...EMPTY,
    messages: [
      user('prior', 'already answered'),
      { ...shell('prior-answer'), content: 'previous result' },
      user('server-user', 'server finished this'),
      { ...shell('server-answer'), content: 'recovered by the record' },
    ],
  })
  assert.equal(store.get('s').retryableSend, null, 'an assistant after this operation baseline proves completion')
  assert.equal(store.get('s').sendFailure, null)
  assert.deepEqual(
    store.get('s').live.messages.map((message) => message.id),
    ['prior', 'prior-answer', 'server-user', 'server-answer'],
    'the authoritative suffix replaces the optimistic row without duplication',
  )

  const unpersistedSend = store.dispatchTurn('s', 'never reached the server')
  await tick()
  sends[1]!.fail(new Error('request refused before persistence'))
  await unpersistedSend
  const optimisticId = store.get('s').retryableSend?.userMessageId
  store.reconcile('s', store.epoch('s'), {
    ...EMPTY,
    messages: [
      user('prior', 'already answered'),
      { ...shell('prior-answer'), content: 'previous result' },
      user('server-user', 'server finished this'),
      { ...shell('server-answer'), content: 'recovered by the record' },
    ],
  })
  assert.equal(store.get('s').retryableSend?.userMessageId, optimisticId, 'Retry remains available')
  assert.equal(store.get('s').live.messages.at(-1)?.content, 'never reached the server')
  assert.equal(store.get('s').live.messages.filter((message) => message.content === 'never reached the server').length, 1)

  store.reconcile('s', store.epoch('s'), {
    ...EMPTY,
    messages: [{ id: 'compacted', role: 'assistant', content: 'authoritative compacted history', compactedFrom: 4 }],
  })
  assert.equal(store.get('s').retryableSend?.userMessageId, optimisticId, 'an absent boundary cannot invent completion')
  assert.deepEqual(
    store.get('s').live.messages.map((message) => message.id),
    ['compacted', optimisticId],
    'compaction stays authoritative while the unpersisted operation remains visible once',
  )
})

test('a failed reattach keeps retry available after rendering a partial assistant reply', async () => {
  const { transport, sends, reattaches } = fakeTransport()
  const store = createConversationStore(transport, empty)
  store.reset('s', { ...EMPTY, messages: [user('server-user', 'finish this')] })

  store.reattach('s', 'turn-live')
  await tick()
  reattaches[0]!.handlers.onStart?.('partial', shell('partial'), 'turn-live')
  reattaches[0]!.handlers.onDelta?.('partial', 'unfinished')
  reattaches[0]!.fail(new Error('reattach interrupted'))
  await tick()
  await tick()

  assert.equal(store.get('s').retryableSend?.text, 'finish this')
  assert.equal(store.get('s').retryableSend?.turnId, 'turn-live')
  assert.equal(store.get('s').live.messages.at(-1)?.content, 'unfinished')

  const retry = store.retryTurn('s')
  await tick()
  assert.deepEqual(
    store.get('s').live.messages.map((message) => [message.role, message.content]),
    [['user', 'finish this']],
    'retry removes the replayed partial before starting again',
  )
  assert.equal(sends.length, 0, 'retry reattaches the known turn instead of risking duplicate work')
  assert.equal(reattaches.length, 2)
  assert.equal(reattaches[1]!.turnId, 'turn-live')
  reattaches[1]!.handlers.onEnd?.({ id: 'complete', role: 'assistant', content: 'finished' })
  reattaches[1]!.finish()
  await retry
  assert.deepEqual(store.get('s').live.messages.map((message) => message.role), ['user', 'assistant'])
})

test('a stale 404 reattach reconciles the persisted answer before exposing interruption', async () => {
  const { transport, reattaches } = fakeTransport()
  let release!: (value: { live: Live; activeTurnId?: string; history?: { olderCursor: string | null; olderTokens: number } }) => void
  const store = createConversationStore(
    {
      ...transport,
      reconcileSession: () => new Promise((resolve) => { release = resolve }),
    },
    empty,
  )
  store.reset('s', { ...EMPTY, messages: [user('server-user', 'finish this')] })
  store.reconcile('s', store.epoch('s'), { ...EMPTY, messages: [user('server-user', 'finish this')] }, { olderCursor: 'old', olderTokens: 2 })

  const reattach = store.reattach('s', 'turn-live')
  await tick()
  const notFound = Object.assign(new Error('No live turn'), { code: 'live_turn_unavailable' })
  reattaches[0]!.fail(notFound)
  await tick()
  assert.equal(store.get('s').busy, true, 'the stale handle stays busy during authoritative recovery')
  assert.equal(store.get('s').retryableSend, null, 'Retry is not exposed before authoritative recovery')
  assert.equal(store.get('s').sendFailure, null, 'interruption is not exposed before authoritative recovery')
  release({
    live: { ...EMPTY, messages: [user('server-user', 'finish this'), { id: 'answer', role: 'assistant', content: 'finished' }] },
    history: { olderCursor: 'fresh', olderTokens: 3 },
  })
  await reattach
  await tick()

  assert.deepEqual(store.get('s').live.messages.map((message) => message.content), ['finish this', 'finished'])
  assert.deepEqual(store.get('s').history, { olderCursor: 'old', olderTokens: 2, loading: false, error: null }, 'loaded history is retained')
  assert.equal(store.get('s').retryableSend, null)
  assert.equal(store.get('s').sendFailure, null)
  assert.equal(store.get('s').busy, false)
})

test('a stale 404 with an authoritative active turn does not clear Retry from a prior assistant', async () => {
  const { transport, reattaches } = fakeTransport()
  const store = createConversationStore(
    {
      ...transport,
      reconcileSession: async () => ({
        activeTurnId: 'new-live-turn',
        live: {
          ...EMPTY,
          messages: [
            user('prior-user', 'prior'),
            { id: 'prior-answer', role: 'assistant', content: 'prior answer' },
            user('server-user', 'finish this'),
            { id: 'partial', role: 'assistant', content: 'partial' },
          ],
        },
      }),
    },
    empty,
  )
  store.reset('s', {
    ...EMPTY,
    messages: [user('prior-user', 'prior'), { id: 'prior-answer', role: 'assistant', content: 'prior answer' }, user('server-user', 'finish this')],
  })

  const reattach = store.reattach('s', 'turn-live')
  await tick()
  reattaches[0]!.fail(Object.assign(new Error('No live turn'), { code: 'live_turn_unavailable' }))
  await reattach
  await tick()

  assert.equal(store.get('s').retryableSend?.turnId, 'turn-live')
  assert.match(store.get('s').sendFailure ?? '', /No live turn/)
  assert.equal(store.get('s').busy, false)
})

test('a stale 404 without a captured user boundary cannot declare an assistant-only record complete', async () => {
  const { transport, reattaches } = fakeTransport()
  const store = createConversationStore(
    {
      ...transport,
      reconcileSession: async () => ({
        live: { ...EMPTY, messages: [{ id: 'answer', role: 'assistant', content: 'unproven' }] },
      }),
    },
    empty,
  )
  store.reset('s', EMPTY)

  const reattach = store.reattach('s', 'turn-live')
  await tick()
  reattaches[0]!.fail(Object.assign(new Error('No live turn'), { code: 'live_turn_unavailable' }))
  await reattach
  await tick()

  assert.match(store.get('s').sendFailure ?? '', /No live turn/)
  assert.deepEqual(store.get('s').live.messages.map((message) => message.content), ['unproven'])
})

test('a stale 404 whose authoritative refetch fails remains an explicit interruption', async () => {
  const { transport, reattaches } = fakeTransport()
  const store = createConversationStore(
    {
      ...transport,
      reconcileSession: async () => { throw new Error('session read failed') },
    },
    empty,
  )
  store.reset('s', { ...EMPTY, messages: [user('server-user', 'finish this')] })

  const reattach = store.reattach('s', 'turn-live')
  await tick()
  reattaches[0]!.fail(Object.assign(new Error('No live turn'), { code: 'live_turn_unavailable' }))
  await reattach
  await tick()

  assert.match(store.get('s').sendFailure ?? '', /No live turn/)
  assert.equal(store.get('s').retryableSend?.turnId, 'turn-live')
})

test('recovery deadline overrides cannot disable or exceed the production bound', () => {
  const { transport } = fakeTransport()
  for (const reattachRecoveryTimeoutMs of [0, -1, 0.5, NaN, Infinity, 30_001, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => createConversationStore(transport, empty, { reattachRecoveryTimeoutMs }), RangeError)
  }
})

test('a hung stale-404 refetch aborts at the deadline and releases busy exactly once', async () => {
  const { transport, reattaches } = fakeTransport()
  let signal!: AbortSignal
  let reads = 0
  let releaseAuthority!: (value: { live: Live }) => void
  const store = createConversationStore(
    {
      ...transport,
      reconcileSession: (_id, incoming) => {
        reads += 1
        signal = incoming!
        return new Promise((resolve) => { releaseAuthority = resolve })
      },
    },
    empty,
    { reattachRecoveryTimeoutMs: 5 },
  )
  store.reset('s', { ...EMPTY, messages: [user('server-user', 'finish this')] })
  const reattach = store.reattach('s', 'turn-live')
  await tick()
  reattaches[0]!.fail(Object.assign(new Error('No live turn'), { code: 'live_turn_unavailable' }))
  await reattach

  assert.equal(reads, 1)
  assert.equal(signal.aborted, true)
  assert.equal(store.get('s').busy, false)
  assert.equal(store.get('s').retryableSend?.turnId, 'turn-live')
  assert.match(store.get('s').sendFailure ?? '', /No live turn/)
  releaseAuthority({ live: { ...EMPTY, messages: [user('server-user', 'finish this'), { id: 'late', role: 'assistant', content: 'late data' }] } })
  await tick()
  assert.deepEqual(store.get('s').live.messages.map((message) => message.content), ['finish this'], 'late post-timeout data is ignored')
})

test('a late stale-404 refetch cannot repopulate a disposed account entry', async () => {
  const { transport, reattaches } = fakeTransport()
  let release!: (value: { live: Live; activeTurnId?: string }) => void
  const store = createConversationStore(
    {
      ...transport,
      reconcileSession: () => new Promise((resolve) => { release = resolve }),
    },
    empty,
  )
  store.reset('s', { ...EMPTY, messages: [user('server-user', 'finish this')] })

  const reattach = store.reattach('s', 'turn-live')
  await tick()
  reattaches[0]!.fail(Object.assign(new Error('No live turn'), { code: 'live_turn_unavailable' }))
  await tick()
  await tick()
  store.clearAll()
  release({ live: { ...EMPTY, messages: [user('server-user', 'finish this'), { id: 'answer', role: 'assistant', content: 'late' }] } })
  await reattach
  await tick()

  assert.deepEqual(store.get('s').live.messages, [])
  assert.equal(store.get('s').sendFailure, null)
})

test('an epoch already disposed before stale-404 handling does not start an authority read', async () => {
  const { transport, reattaches } = fakeTransport()
  let reads = 0
  const store = createConversationStore(
    {
      ...transport,
      reconcileSession: async () => {
        reads += 1
        return { live: EMPTY }
      },
    },
    empty,
  )
  store.reset('s', { ...EMPTY, messages: [user('server-user', 'finish this')] })
  const reattach = store.reattach('s', 'turn-live')
  await tick()
  store.clearAll()
  reattaches[0]!.fail(Object.assign(new Error('No live turn'), { code: 'live_turn_unavailable' }))
  await reattach
  assert.equal(reads, 0, 'the account/reset fence is checked before fetch')
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

test('focus is per session (Phase 6): keyed isolation, adopt carries it, reset clears it', () => {
  const { transport } = fakeTransport()
  const store = createConversationStore(transport, empty)
  // Keyed isolation — every pane derives its OWN context panel from its
  // session's focus; setting one session's never touches another's.
  store.setFocus('a', { kind: 'repo', id: 'repo-1' })
  store.setFocus('b', { kind: 'workspace', id: 'ws-1' })
  assert.deepEqual(store.get('a').focus, { kind: 'repo', id: 'repo-1' })
  assert.deepEqual(store.get('b').focus, { kind: 'workspace', id: 'ws-1' })
  // Toggle-to-closed is a plain null write.
  store.setFocus('b', null)
  assert.equal(store.get('b').focus, null)
  assert.deepEqual(store.get('a').focus, { kind: 'repo', id: 'repo-1' }, 'closing b leaves a untouched')
  // Draft materialization: the draft's panel choice rides adopt onto the real id
  // (the FWD-2 carry the singleton used to hand-roll via a dispatch-time capture).
  store.setFocus('draft', { kind: 'connector', id: 'c-1' })
  store.update('draft', (s) => ({ ...s, live: { ...EMPTY, messages: [user('u1', 'first')] } }))
  store.adopt('draft', 'real-9')
  assert.deepEqual(store.get('real-9').focus, { kind: 'connector', id: 'c-1' }, 'focus moved with the entry')
  assert.equal(store.get('draft').focus, null, 'the draft slot is blank again')
  // A focus-only entry is NOT blank — adopt moves it (the store contract; no
  // UI path hits this today, but the blank-guard must count every state field).
  store.setFocus('draft2', { kind: 'repo', id: 'r-2' })
  store.adopt('draft2', 'real-10')
  assert.deepEqual(store.get('real-10').focus, { kind: 'repo', id: 'r-2' }, 'a focus-only entry still moves')
  // A select-time reset seeds a fresh entry — focus starts closed (the caller
  // restores the remembered pref explicitly, panelPrefs / FWD-2).
  store.setFocus('s', { kind: 'repo', id: 'r' })
  store.reset('s', EMPTY)
  assert.equal(store.get('s').focus, null)
  // setFocus notifies the entry's subscribers (a pane re-renders its panel).
  let notified = 0
  store.subscribe('a', () => (notified += 1))
  store.setFocus('a', null)
  assert.equal(notified, 1)
})

test('unsent composer text follows its session through reconciliation and adoption, never account disposal', () => {
  const { transport } = fakeTransport()
  const store = createConversationStore(transport, empty)
  const text = 'Unsent first line\nSecond line · café 世界'
  store.patch('s', { composerText: text })
  assert.equal(store.get('other').composerText, '')
  store.reconcile('s', store.epoch('s'), EMPTY)
  store.setFocus('s', { kind: 'repo', id: 'repo-1' })
  store.setLive('s', EMPTY)
  assert.equal(store.get('s').composerText, text, 'server and pane projections cannot erase local input')
  store.patch('draft', { composerText: text })
  store.adopt('draft', 'materialized')
  assert.equal(store.get('materialized').composerText, text)
  assert.equal(store.get('draft').composerText, '')
  store.reset('s', EMPTY)
  assert.equal(store.get('s').composerText, '', 'explicit reset starts clean')
  store.clearAll()
  assert.equal(store.get('materialized').composerText, '', 'an outgoing account retains no private input')
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
