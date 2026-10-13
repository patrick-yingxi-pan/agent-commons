import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { ScheduledTask } from '../../contract/index.ts'
import { paths } from './keys.ts'
import { reconcileScheduleRunStop, scheduleRunStopSettled, stopScheduleRun } from './scheduleRunStopCommands.ts'
import { refreshAccount } from './account.ts'
import { peek, resetAll, setData } from './cache.ts'
import { keys } from './keys.ts'
import { onSessionPush } from './sessionRefresh.ts'
import { runSessionId } from '../../contract/ids.ts'
import { AccountSwitchedError } from './client.ts'

test('Stop route path encodes both frozen identities', () => {
  assert.equal(paths.scheduleRunStop('routine/a', 'run b'), '/schedules/routine%2Fa/runs/run%20b/stop')
})

test('stop reconciliation settles only an exact terminal run, never a newer run', () => {
  const task = { id: 'routine-a', runs: [
    { id: 'run-old', status: 'cancelled' },
    { id: 'run-new', status: 'running' },
  ] } as ScheduledTask
  assert.equal(scheduleRunStopSettled([task], { scheduleId: 'routine-a', runId: 'run-old' }), true)
  assert.equal(scheduleRunStopSettled([task], { scheduleId: 'routine-a', runId: 'run-new' }), false)
  assert.equal(scheduleRunStopSettled([task], { scheduleId: 'other', runId: 'run-old' }), false)
})

test('Stop acknowledgement and exact recovery refresh open transcripts without live sync', async t => {
  const originalFetch = globalThis.fetch
  refreshAccount({ userId: 'owner', tenantId: 'tenant' })
  t.after(() => { globalThis.fetch = originalFetch; refreshAccount(null); resetAll() })
  const intent = { scheduleId: 'routine-a', runId: 'run-a' }
  const run = { id: intent.runId, status: 'cancelled', at: 100, attempts: 1 }
  const task = { id: intent.scheduleId, revision: 2, enabled: false, lastStatus: 'cancelled', runs: [run] }
  setData(keys.schedules, [{ ...task, revision: 1, enabled: true, lastStatus: 'pending', runs: [{ ...run, status: 'running' }] }])
  const refreshed: string[] = []
  t.after(onSessionPush(id => refreshed.push(id)))
  globalThis.fetch = async (_url, init) => {
    if (init?.method === 'POST') assert.equal(new Headers(init.headers).get('Idempotency-Key'), 'stop-key')
    return new Response(JSON.stringify(init?.method === 'POST' ? run : [task]), { headers: { 'x-resolved-tenant': 'tenant' } })
  }
  await stopScheduleRun(intent, 'stop-key')
  assert.equal(await reconcileScheduleRunStop(intent), true)
  const current = peek<ScheduledTask[]>(keys.schedules)![0]!
  assert.deepEqual({ id: current.id, revision: current.revision, enabled: current.enabled, lastStatus: current.lastStatus, runs: current.runs }, task,
    'authoritative pause and terminal status are refreshed')
  assert.deepEqual(refreshed, [runSessionId(intent.scheduleId, intent.runId), runSessionId(intent.scheduleId, intent.runId)])
})

for (const returnToOwner of [false, true]) {
  test(`Stop acknowledgement cannot publish after account transition${returnToOwner ? ' away and back' : ''}`, async t => {
    const originalFetch = globalThis.fetch
    refreshAccount({ userId: 'owner', tenantId: 'tenant' })
    t.after(() => { globalThis.fetch = originalFetch; refreshAccount(null); resetAll() })
    let reads = 0
    globalThis.fetch = async () => ({ ok: true, status: 200,
      headers: { get() {
        if (++reads === 2) queueMicrotask(() => {
          refreshAccount({ userId: 'other', tenantId: 'other-tenant' }); resetAll()
          if (returnToOwner) refreshAccount({ userId: 'owner', tenantId: 'tenant' })
        })
        return 'tenant'
      } }, text: async () => JSON.stringify({ id: 'run-a', status: 'cancelled' }),
    }) as Response
    await assert.rejects(stopScheduleRun({ scheduleId: 'routine-a', runId: 'run-a' }, 'stop-key'), AccountSwitchedError)
    assert.equal(reads, 2)
    assert.equal(peek(keys.schedules), undefined)
  })
}
