/** Failure-first locks for the server-owned conversation Stop lifecycle. */
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
const assistant = (id: string, content = ''): Message => ({ id, role: 'assistant', content })
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

interface CancelCall {
  sessionId: string
  turnId: string
  signal?: AbortSignal
  resolve: () => void
  reject: (error: Error) => void
}

function fixture(options: Parameters<typeof createConversationStore>[2] = {}) {
  const calls: CancelCall[] = []
  const streams: Array<{
    sessionId: string
    turnId: string
    handlers: TurnHandlers
    finish: () => void
    fail: (error: Error) => void
  }> = []
  let cancelBehavior: 'deferred' | 'sync-throw' = 'deferred'
  const transport: ConversationTransport = {
    sendMessage: () => Promise.resolve(),
    reattachTurn: (sessionId, turnId, _from, handlers) =>
      new Promise<void>((resolve, reject) => {
        streams.push({ sessionId, turnId, handlers, finish: resolve, fail: reject })
      }),
    cancelTurn: (sessionId, turnId, signal) => {
      if (cancelBehavior === 'sync-throw') throw new Error('cancel transport threw')
      return new Promise<void>((resolve, reject) => calls.push({ sessionId, turnId, signal, resolve, reject }))
    },
  }
  const store = createConversationStore(transport, empty, options)
  const attach = (sessionId: string, turnId: string) => store.reattach(sessionId, turnId)
  const finish = async (index: number, message: Message = assistant(`answer-${index}`, 'complete')) => {
    streams[index]!.handlers.onEnd?.(message)
    streams[index]!.finish()
    await tick()
  }
  return {
    store,
    calls,
    streams,
    attach,
    finish,
    setSyncThrow: () => { cancelBehavior = 'sync-throw' },
  }
}

test('Stop tracks pending then requested, coalesces one turn, and waits for stream settlement', async () => {
  const f = fixture()
  const stream = f.attach('s', 'turn-1')
  await tick()
  assert.equal(f.streams[0]?.turnId, 'turn-1')

  const first = f.store.stop('s')
  assert.deepEqual(f.store.get('s').stopRequest, { turnId: 'turn-1', phase: 'pending' })
  assert.equal(f.calls.length, 1)
  assert.equal(f.calls[0]!.sessionId, 's')
  assert.equal(f.calls[0]!.turnId, 'turn-1')
  assert.ok(f.calls[0]!.signal instanceof AbortSignal, 'cancellation has a lifecycle signal')

  const joined = f.store.stop('s')
  assert.equal(f.calls.length, 1, 'a second Stop joins the in-flight cancellation')
  f.calls[0]!.resolve()
  await Promise.all([first, joined])
  assert.deepEqual(f.store.get('s').stopRequest, { turnId: 'turn-1', phase: 'requested' })
  assert.equal(f.store.get('s').busy, true, 'HTTP acknowledgement is not stream settlement')
  assert.deepEqual(f.store.get('s').liveTurn, { sessionId: 's', turnId: 'turn-1' })

  await f.store.stop('s')
  assert.equal(f.calls.length, 1, 'a requested Stop is not sent again automatically')
  await f.finish(0)
  await stream
  assert.equal(f.store.get('s').stopRequest, null, 'the actual reply terminal clears Stop state')
  assert.equal(f.store.get('s').busy, false)
  assert.equal(f.store.get('s').liveTurn, null)
})

test('rejected cancellation retains the live turn and partial reply; Retry targets that turn', async () => {
  const f = fixture()
  const stream = f.attach('s', 'turn-2')
  await tick()
  assert.equal(f.streams[0]?.turnId, 'turn-2')
  f.streams[0]!.handlers.onStart?.('partial', assistant('partial'), 'turn-2')
  f.streams[0]!.handlers.onDelta?.('partial', 'still here')
  f.store.patch('s', { sendFailure: 'existing stream warning' })

  const first = f.store.stop('s')
  f.calls[0]!.reject(new Error('network down'))
  await first
  assert.deepEqual(f.store.get('s').stopRequest, { turnId: 'turn-2', phase: 'failed' })
  assert.equal(f.store.get('s').busy, true)
  assert.deepEqual(f.store.get('s').liveTurn, { sessionId: 's', turnId: 'turn-2' })
  assert.equal(f.store.get('s').sendFailure, 'existing stream warning')
  assert.equal(f.store.get('s').live.messages.at(-1)?.content, 'still here')

  const retry = f.store.stop('s')
  assert.equal(f.calls.length, 2)
  assert.equal(f.calls[1]!.turnId, 'turn-2', 'explicit retry addresses the same live turn')
  f.calls[1]!.resolve()
  await retry
  assert.deepEqual(f.store.get('s').stopRequest, { turnId: 'turn-2', phase: 'requested' })

  f.store.stop('s')
  assert.equal(f.calls.length, 2, 'requested state coalesces further Stop clicks')
  await f.finish(0)
  await stream
  assert.equal(f.store.get('s').stopRequest, null)
})

test('a synchronous cancel transport throw becomes failed state instead of escaping', async () => {
  const f = fixture()
  const stream = f.attach('s', 'turn-sync-throw')
  await tick()
  f.streams[0]!.handlers.onStart?.('partial', assistant('partial'), 'turn-sync-throw')
  f.streams[0]!.handlers.onDelta?.('partial', 'still here')
  f.store.patch('s', { sendFailure: 'existing stream warning' })
  f.setSyncThrow()

  await assert.doesNotReject(f.store.stop('s'))
  assert.deepEqual(f.store.get('s').stopRequest, { turnId: 'turn-sync-throw', phase: 'failed' })
  assert.equal(f.store.get('s').busy, true)
  assert.deepEqual(f.store.get('s').liveTurn, { sessionId: 's', turnId: 'turn-sync-throw' })
  assert.equal(f.store.get('s').sendFailure, 'existing stream warning')
  assert.equal(f.store.get('s').live.messages.at(-1)?.content, 'still here')

  await f.finish(0)
  await stream
})

test('reset and account clear abort pending cancellation and fence late acknowledgements', async () => {
  for (const dispose of ['reset', 'clearAll'] as const) {
    const f = fixture()
    const stream = f.attach('s', `turn-${dispose}`)
    await tick()
    const stop = f.store.stop('s')
    const signal = f.calls[0]!.signal
    assert.ok(signal)

    if (dispose === 'reset') f.store.reset('s', EMPTY)
    else f.store.clearAll()
    assert.equal(signal.aborted, true, `${dispose} aborts its pending cancellation request`)

    f.calls[0]!.resolve()
    await stop
    assert.equal(f.store.get('s').stopRequest, null, 'late acknowledgement cannot repopulate disposed state')
    assert.equal(f.store.get('s').busy, false)
    f.streams[0]!.finish()
    await stream
  }
})

test('stream completion aborts pending cancellation and ignores its late response', async () => {
  const f = fixture()
  const stream = f.attach('s', 'turn-completes-first')
  await tick()
  const stop = f.store.stop('s')
  const signal = f.calls[0]!.signal
  assert.ok(signal)

  await f.finish(0)
  await stream
  assert.equal(signal.aborted, true, 'completion retires an outstanding cancel request')
  assert.equal(f.store.get('s').stopRequest, null)

  f.calls[0]!.resolve()
  await stop
  assert.equal(f.store.get('s').stopRequest, null, 'late cancel acknowledgement stays fenced')
})

test('late cancellation from a completed turn cannot change the next turn state', async () => {
  const f = fixture()
  const firstStream = f.attach('s', 'turn-old')
  await tick()
  const oldStop = f.store.stop('s')
  await f.finish(0)
  await firstStream
  assert.equal(f.calls[0]!.signal?.aborted, true)

  const nextStream = f.attach('s', 'turn-new')
  await tick()
  const newStop = f.store.stop('s')
  assert.deepEqual(f.store.get('s').stopRequest, { turnId: 'turn-new', phase: 'pending' })

  f.calls[0]!.resolve()
  await oldStop
  assert.deepEqual(f.store.get('s').stopRequest, { turnId: 'turn-new', phase: 'pending' })
  assert.deepEqual(f.store.get('s').liveTurn, { sessionId: 's', turnId: 'turn-new' })

  f.calls[1]!.resolve()
  await newStop
  await f.finish(1)
  await nextStream
})

test('disposing synchronously from pending-state publication prevents a stale cancel dispatch', async () => {
  const f = fixture()
  const stream = f.attach('s', 'turn-disposed-during-publish')
  await tick()
  let disposed = false
  const unsubscribe = f.store.subscribe('s', () => {
    if (!disposed && f.store.get('s').stopRequest?.phase === 'pending') {
      disposed = true
      f.store.reset('s', EMPTY)
    }
  })

  await f.store.stop('s')
  unsubscribe()
  assert.equal(disposed, true)
  assert.equal(f.calls.length, 0, 'the cancel route is not invoked after synchronous disposal')
  assert.equal(f.store.get('s').stopRequest, null)
  assert.equal(f.store.get('s').busy, false)

  f.streams[0]!.finish()
  await stream
})

test('Stop state is isolated by session and a missing turn handle is a no-op', async () => {
  const f = fixture()
  const a = f.attach('a', 'turn-a')
  const b = f.attach('b', 'turn-b')
  await tick()
  assert.deepEqual(f.streams.map((stream) => stream.turnId), ['turn-a', 'turn-b'])
  const stopA = f.store.stop('a')
  const stopB = f.store.stop('b')
  assert.equal(f.calls.length, 2)
  f.calls[0]!.resolve()
  await stopA
  assert.deepEqual(f.store.get('a').stopRequest, { turnId: 'turn-a', phase: 'requested' })
  assert.deepEqual(f.store.get('b').stopRequest, { turnId: 'turn-b', phase: 'pending' })
  f.calls[1]!.resolve()
  await stopB

  const before = f.calls.length
  await f.store.stop('missing')
  assert.equal(f.calls.length, before)
  assert.equal(f.store.get('missing').stopRequest, null)
})

test('Stop timeout aborts the request, exposes retry, and never resends automatically', async () => {
  const f = fixture({ stopRequestTimeoutMs: 10 })
  const stream = f.attach('s', 'turn-timeout')
  await tick()

  await f.store.stop('s')
  assert.equal(f.calls[0]!.signal?.aborted, true)
  assert.deepEqual(f.store.get('s').stopRequest, { turnId: 'turn-timeout', phase: 'failed' })
  assert.equal(f.calls.length, 1)

  const retry = f.store.stop('s')
  assert.equal(f.calls.length, 2, 'a later explicit Stop retries after timeout')
  f.calls[1]!.resolve()
  await retry
  assert.deepEqual(f.store.get('s').stopRequest, { turnId: 'turn-timeout', phase: 'requested' })

  await f.finish(0)
  await stream
})

test('Stop request timeout accepts bounded integer values', () => {
  for (const stopRequestTimeoutMs of [1, 30_000]) {
    assert.doesNotThrow(() => fixture({ stopRequestTimeoutMs }))
  }
  for (const stopRequestTimeoutMs of [0, -1, 1.5, NaN, Infinity, 30_001]) {
    assert.throws(() => fixture({ stopRequestTimeoutMs }), RangeError)
  }
})
