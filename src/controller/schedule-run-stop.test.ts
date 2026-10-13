import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createAcknowledgedActionMutationController } from './acknowledgedActionMutationCore.ts'
import { createScheduleRunStopMutationFacade } from './scheduleRunStopMutations.ts'

test('routine Stop retry retains one exact run target and idempotency key across newer runs', async () => {
  const intent = { scheduleId: 'routine-a', runId: 'run-a' }
  const sent: Array<{ intent: typeof intent; key: string }> = []
  const reconciled: typeof intent[] = []
  let attempts = 0
  const controller = createAcknowledgedActionMutationController<typeof intent, string | null>({
    resourceId: (value) => `${value.scheduleId}:${value.runId}`,
    snapshot: () => 'running',
    mutate: async (value, key) => {
      sent.push({ intent: value, key })
      attempts += 1
      if (attempts === 1) throw new Error('lost acknowledgement')
    },
    reconcile: async (value) => {
      reconciled.push(value)
      return false // another run appearing cannot settle this target
    },
    describeFailure: () => ({ message: 'uncertain', retryable: true }),
    setStatus: () => {},
    mintIdempotencyKey: () => 'stable-stop-key',
  })

  const outcome = controller.enqueue(intent)
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(reconciled, [intent])
  controller.retry()
  assert.equal(await outcome, 'applied')
  assert.deepEqual(sent, [
    { intent, key: 'stable-stop-key' },
    { intent, key: 'stable-stop-key' },
  ])
  assert.deepEqual(reconciled, [intent])
})

test('a rejected Stop runtime import keeps the exact run held and Retry sends no request until loading succeeds', async (t) => {
  const statuses: Array<{ error: string | null; retryable: boolean; pendingCount: number }> = []
  let failLoad = true
  let loads = 0
  const dispatched: Array<{ scheduleId: string; runId: string }> = []
  const fakeRuntime = {
    enqueueScheduleRunStopRuntime: async (intent: { scheduleId: string; runId: string }) => {
      dispatched.push(intent)
      return 'applied' as const
    },
    retryScheduleRunStopRuntime: () => undefined,
    discardScheduleRunStopRuntime: () => undefined,
    clearScheduleRunStops: () => undefined,
  }
  const facade = createScheduleRunStopMutationFacade({
    subscribeAccountSwitch: () => () => undefined,
    onStatus: (status) => statuses.push({ error: status.error, retryable: status.retryable, pendingCount: status.pendingCount }),
    loadRuntime: async () => {
      loads += 1
      if (failLoad) throw new Error('simulated chunk refusal')
      return fakeRuntime as unknown as typeof import('./scheduleRunStopRuntime')
    },
  })
  t.after(facade.dispose)

  const original = { scheduleId: 'frozen-schedule', runId: 'frozen-run' }
  const action = facade.enqueue(original)
  assert.strictEqual(facade.enqueue(original), action, 'repeated clicks coalesce to the held exact run')
  original.runId = 'different-later-run'
  let settled = false
  void action.then(() => { settled = true })
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(facade.isHeld({ scheduleId: 'frozen-schedule', runId: 'frozen-run' }), true)
  assert.equal(settled, false, 'import rejection must not silently settle or release the action')
  assert.equal(dispatched.length, 0, 'a failed import has not issued a Stop request')
  assert.equal(loads, 1)
  assert.equal(statuses.at(-1)?.retryable, true)
  assert.equal(statuses.at(-1)?.pendingCount, 1)
  assert.match(statuses.at(-1)?.error ?? '', /No Stop request was sent.*Retry.*Dismiss.*copy unsent text before reloading/)

  failLoad = false
  facade.retry()
  assert.equal(await action, 'applied')
  assert.equal(loads, 2, 'Retry drops the rejected import promise and loads again')
  assert.deepEqual(dispatched, [{ scheduleId: 'frozen-schedule', runId: 'frozen-run' }])
  assert.equal(facade.isHeld({ scheduleId: 'frozen-schedule', runId: 'frozen-run' }), false)
})

test('failed lazy load retains a FIFO of distinct run targets; Dismiss releases only its head', async (t) => {
  let failLoad = true
  let loads = 0
  const dispatched: Array<{ scheduleId: string; runId: string }> = []
  const fakeRuntime = {
    enqueueScheduleRunStopRuntime: async (intent: { scheduleId: string; runId: string }) => {
      dispatched.push(intent)
      return 'applied' as const
    },
    retryScheduleRunStopRuntime: () => undefined,
    discardScheduleRunStopRuntime: () => undefined,
    clearScheduleRunStops: () => undefined,
  }
  const facade = createScheduleRunStopMutationFacade({
    subscribeAccountSwitch: () => () => undefined,
    loadRuntime: async () => {
      loads += 1
      if (failLoad) throw new Error('simulated chunk refusal')
      return fakeRuntime as unknown as typeof import('./scheduleRunStopRuntime')
    },
  })
  t.after(facade.dispose)

  const firstTarget = { scheduleId: 'routine-first', runId: 'run-first' }
  const secondTarget = { scheduleId: 'routine-second', runId: 'run-second' }
  const first = facade.enqueue(firstTarget)
  const second = facade.enqueue(secondTarget)
  assert.strictEqual(facade.enqueue(secondTarget), second, 'same run coalesces even behind another held run')
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(loads, 1, 'concurrent exact targets share one import attempt')
  assert.equal(facade.isHeld(firstTarget), true)
  assert.equal(facade.isHeld(secondTarget), true)

  facade.dismiss()
  assert.equal(await first, 'discarded')
  assert.equal(facade.isHeld(firstTarget), false)
  assert.equal(facade.isHeld(secondTarget), true, 'dismissing the failed head preserves the next exact run')
  assert.deepEqual(dispatched, [], 'neither failed import nor Dismiss sends transport')

  failLoad = false
  facade.retry()
  assert.equal(await second, 'applied')
  assert.equal(loads, 2)
  assert.deepEqual(dispatched, [secondTarget], 'Retry dispatches only the remaining frozen run target')
})

test('Dismiss after Stop runtime import failure sends nothing and account switch fences a late load', async (t) => {
  let accountSwitch!: () => void
  let resolveLoad!: (runtime: typeof import('./scheduleRunStopRuntime')) => void
  let dispatched = 0
  const fakeRuntime = {
    enqueueScheduleRunStopRuntime: async () => { dispatched += 1; return 'applied' as const },
    retryScheduleRunStopRuntime: () => undefined,
    discardScheduleRunStopRuntime: () => undefined,
    clearScheduleRunStops: () => undefined,
  }
  const failed = createScheduleRunStopMutationFacade({
    subscribeAccountSwitch: (listener) => { accountSwitch = listener; return () => undefined },
    loadRuntime: async () => { throw new Error('simulated chunk refusal') },
  })
  t.after(failed.dispose)
  const dismissed = failed.enqueue({ scheduleId: 'dismiss-schedule', runId: 'dismiss-run' })
  await new Promise((resolve) => setImmediate(resolve))
  failed.dismiss()
  assert.equal(await dismissed, 'discarded')
  assert.equal(dispatched, 0, 'Dismiss never starts transport')
  assert.equal(failed.isHeld({ scheduleId: 'dismiss-schedule', runId: 'dismiss-run' }), false)

  const pending = createScheduleRunStopMutationFacade({
    subscribeAccountSwitch: (listener) => { accountSwitch = listener; return () => undefined },
    loadRuntime: () => new Promise((resolve) => { resolveLoad = resolve }),
  })
  t.after(pending.dispose)
  const switched = pending.enqueue({ scheduleId: 'old-schedule', runId: 'old-run' })
  accountSwitch()
  assert.equal(await switched, 'discarded')
  resolveLoad(fakeRuntime as unknown as typeof import('./scheduleRunStopRuntime'))
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(dispatched, 0, 'a runtime resolving after account switch cannot dispatch the held Stop')
  assert.equal(pending.isHeld({ scheduleId: 'old-schedule', runId: 'old-run' }), false)
})
