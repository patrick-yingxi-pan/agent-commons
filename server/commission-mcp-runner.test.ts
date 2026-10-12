import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createCommissionMcpRunner, commissionMcpLegacyDispatchBlocked, type CommissionMcpQueueCandidate } from './commissionMcpRunner.ts'
import { CommissionMcpRegistry } from './commissionMcpRegistry.ts'
import { commissionMcpClaimId } from './commissionMcpClaim.ts'

const candidate = (itemId: string, tenantId = 'tenant-a', agentId = `agent-${itemId}`): CommissionMcpQueueCandidate => ({
  commissionId: `commission-${itemId}`, tenantId, userId: `person-${tenantId}`,
  projectId: `project-${tenantId}`, agentId, itemId,
})

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

function fakeTimers() {
  let callback: (() => void) | undefined
  let cleared = false
  return {
    timers: {
      setInterval(fn: () => void, ms: number) {
        assert.equal(ms, 5_000)
        callback = fn
        return 1 as unknown as ReturnType<typeof setInterval>
      },
      clearInterval() { cleared = true },
    },
    tick() { callback?.() },
    cleared: () => cleared,
  }
}

test('runner stays within the shared 4 global, 2 tenant, 1 Agent envelope', async () => {
  const waits = Array.from({ length: 6 }, () => deferred())
  const items = [candidate('a', 'tenant-a', 'agent-a'), candidate('b', 'tenant-a', 'agent-b'),
    candidate('c', 'tenant-a', 'agent-c'), candidate('d', 'tenant-b', 'agent-d'),
    candidate('e', 'tenant-b', 'agent-e'), candidate('f', 'tenant-c', 'agent-f')]
  let calls = 0
  const runner = createCommissionMcpRunner({ candidates: () => items,
    run: async () => { await waits[calls++].promise } }, { timers: fakeTimers().timers })
  runner.start()
  await Promise.resolve()
  assert.equal(calls, 4)
  assert.equal(runner.activeCount(), 4)
  waits.forEach(wait => wait.resolve())
  await runner.stop()
  assert.equal(runner.activeCount(), 0)
})

test('a capacity refusal waits for the next bounded tick instead of spinning', async () => {
  const timers = fakeTimers()
  let calls = 0
  const one = candidate('one')
  const runner = createCommissionMcpRunner({ candidates: () => [one], run: async () => {
    calls += 1
    throw new Error('capacity')
  } }, { timers: timers.timers })
  runner.start()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls, 1)
  timers.tick()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls, 2)
  await runner.stop()
  assert.equal(timers.cleared(), true)
})

test('stop aborts active work and retains its slot until the promise settles', async () => {
  const wait = deferred()
  let signal: AbortSignal | undefined
  let calls = 0
  const runner = createCommissionMcpRunner({ candidates: () => [candidate('one')], run: async (_row, value) => {
    calls += 1
    signal = value
    await wait.promise // deliberately ignore abort, like an in-flight external call
  } }, { timers: fakeTimers().timers })
  runner.start()
  await Promise.resolve()
  assert.equal(calls, 1)
  const stopping = runner.stop()
  assert.equal(signal?.aborted, true)
  assert.equal(runner.activeCount(), 1)
  let settled = false
  void stopping.then(() => { settled = true })
  await Promise.resolve()
  assert.equal(settled, false)
  wait.resolve()
  await stopping
  assert.equal(runner.activeCount(), 0)
})

test('stop before the first tick prevents admission', async () => {
  let calls = 0
  const runner = createCommissionMcpRunner({ candidates: () => [candidate('one')], run: async () => { calls += 1 } },
    { timers: fakeTimers().timers })
  await runner.stop()
  runner.start()
  runner.tick()
  assert.equal(calls, 0)
})

test('explicit restore fences remain manual-only for legacy standing dispatch', () => {
  const registry = new CommissionMcpRegistry()
  const id = commissionMcpClaimId('project-restored', 'item-restored')
  registry.restoreBoundary([id], Date.now())
  assert.equal(commissionMcpLegacyDispatchBlocked(registry, 'project-restored', 'item-restored'), true)
})
