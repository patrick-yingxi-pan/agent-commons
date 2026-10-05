import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createConversationStore, type TurnHandlers } from './conversationCore.ts'
import type { Live } from '../data/liveSession.ts'

const empty: Live = { messages: [], workspaces: [], repos: [], connectors: [], attachments: [] }
function fixture() {
  const attached: Array<{ turn: string; handlers: TurnHandlers; finish: () => void; fail: () => void }> = []
  const store = createConversationStore({
    sendMessage: async () => {},
    cancelTurn: async () => {},
    reattachTurn: (_id, turn, _seq, handlers) => new Promise<void>((resolve, reject) => {
      attached.push({ turn, handlers, finish: resolve, fail: () => reject(new Error('Connection interrupted')) })
    }),
  }, () => empty)
  const read = (userId = 'u1') => {
    const receipt = store.beginPaneRead('s')
    assert.equal(store.reconcile('s', receipt, { ...empty, messages: [{ id: userId, role: 'user', content: 'hello' }] }), true)
    return receipt
  }
  return { store, attached, read }
}

test('each new remotely started turn is observed once across duplicate panes and repeated pushes', async () => {
  const { store, attached, read } = fixture()
  store.patch('s', { composerText: 'my unsent draft' })
  const first = store.observeTurn('s', 't1', read())
  assert.equal(attached.length, 1)
  await store.observeTurn('s', 't1', store.beginPaneRead('s'))
  assert.equal(attached.length, 1, 'a second pane cannot create another replay stream')
  attached[0].handlers.onStart?.('a1', { id: 'a1', role: 'assistant', content: '' }, 't1')
  attached[0].handlers.onDelta?.('a1', 'partial')
  assert.equal(store.get('s').live.messages.at(-1)?.content, 'partial')
  attached[0].handlers.onEnd?.({ id: 'a1', role: 'assistant', content: 'complete' })
  attached[0].finish()
  await first
  const staleCompletion = store.observeTurn('s', 't1', store.beginPaneRead('s'))
  assert.equal(attached.length, 1, 'a late active snapshot cannot reopen the completed stream')
  await staleCompletion
  const second = store.observeTurn('s', 't2', read('u2'))
  assert.equal(attached.length, 2, 'observation is not a one-shot mount obligation')
  assert.equal(attached[1].turn, 't2')
  attached[1].finish()
  await second
  assert.equal(store.get('s').composerText, 'my unsent draft')
})

test('stale pane reads and account epochs cannot initiate observation', async () => {
  const { store, attached, read } = fixture()
  const stale = read()
  store.beginPaneRead('s')
  await store.observeTurn('s', 't1', stale)
  const oldAccount = read()
  store.clearAll()
  await store.observeTurn('s', 't1', oldAccount)
  assert.equal(attached.length, 0)
  const current = store.observeTurn('s', 't1', read())
  assert.equal(attached.length, 1)
  store.clearAll()
  attached[0].handlers.onStart?.('a1', { id: 'a1', role: 'assistant', content: 'old account' }, 't1')
  attached[0].finish()
  await current
  assert.deepEqual(store.get('s').live.messages, [])
})

test('observation never takes over an in-flight local send or unresolved retry', async () => {
  const { store, attached, read } = fixture()
  const receipt = read()
  for (const held of [{ busy: true }, { typing: true }, { liveTurn: { sessionId: 's', turnId: 'local' } }, {
    retryableSend: { text: 'hello', idempotencyKey: 'local-key', userMessageId: 'u1' },
  }]) {
    store.patch('s', { busy: false, typing: false, liveTurn: null, retryableSend: null, ...held })
    await store.observeTurn('s', 'remote', receipt)
    assert.equal(attached.length, 0)
  }
  store.patch('s', { retryableSend: null })
  const result = store.observeTurn('s', 'remote', receipt)
  assert.equal(attached.length, 1, 'a skipped busy observation does not consume the turn')
  attached[0].finish()
  await result
})

test('failed observation stays explicit recovery rather than a push-driven reconnect loop', async () => {
  const { store, attached, read } = fixture()
  const pending = store.observeTurn('s', 't1', read())
  attached[0].fail()
  await pending
  assert.equal(store.get('s').sendFailure, 'Connection interrupted')
  await store.observeTurn('s', 't1', store.beginPaneRead('s'))
  assert.equal(attached.length, 1)
  const retry = store.retryTurn('s')
  assert.equal(attached.length, 2, 'explicit owner Retry can reconnect to the same turn')
  attached[1].finish()
  await retry
})

test('synchronous account disposal while publishing stream state prevents transport dispatch', async () => {
  const { store, attached, read } = fixture()
  const receipt = read()
  const unsubscribe = store.subscribe('s', () => {
    if (store.get('s').busy) store.clearAll()
  })
  await store.observeTurn('s', 't1', receipt)
  unsubscribe()
  assert.equal(attached.length, 0)
  assert.equal(store.get('s').busy, false)
})
