import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runSessionId } from '../../contract/ids.ts'
import { configureScheduleExecutor, store } from './index.ts'
import { createRoutineRunner } from '../routineRunner.ts'

const owner = 'tenant-personal'
function fixture() {
  const { id: _id, ...seed } = structuredClone(store.listSchedules(owner)[0]!)
  return store.addSchedule({ ...seed, tenantId: owner, name: 'Stoppable Routine', runs: [], enabled: true,
    steps: [], delivery: { tool: { id: 'assistant', label: 'Assistant', tone: 'claude' }, target: 'Run conversation' } })
}

test('Stop commits the exact queued run, keeps cadence and emits one honest terminal conversation', t => {
  const task = fixture()
  t.after(() => { configureScheduleExecutor(undefined); store.removeSchedule(task.id) })
  const run = store.runSchedule(task.id)!
  const before = { enabled: task.enabled, revision: task.revision, next: task.next, nextFireAt: task.nextFireAt }
  const events: string[] = []
  t.after(store.subscribe(event => { if ('taskId' in event && event.taskId === task.id) events.push(event.type) }))
  let cancellations = 0
  configureScheduleExecutor(undefined, (taskId, runId) => {
    cancellations++
    assert.equal(taskId, task.id)
    assert.equal(runId, run.id)
    assert.equal(run.status, 'cancelled', 'durable state closes before worker interruption')
    assert.equal(store.routineExecutionContext(taskId, runId), undefined)
  })
  assert.equal(store.stopScheduleRun(task.id, run.id, owner, run.at + 1200), run)
  assert.equal(run.status, 'cancelled')
  assert.equal(run.attempts, 0)
  assert.equal(run.nextAttemptAt, undefined)
  assert.equal(run.failureCode, undefined)
  assert.equal(task.lastStatus, 'cancelled')
  assert.deepEqual({ enabled: task.enabled, revision: task.revision, next: task.next, nextFireAt: task.nextFireAt }, before)
  assert.equal(store.pendingScheduleRuns().some(row => row.runId === run.id), false)
  const session = store.getSession(runSessionId(task.id, run.id))!
  assert.equal(session.messages?.filter(row => row.id === 'm2').length, 1)
  assert.match(session.messages!.find(row => row.id === 'm2')!.content, /stopped/i)
  assert.equal(cancellations, 1)
  assert.deepEqual(events, ['run.finished'])
  const frozen = structuredClone(run)
  assert.deepEqual(store.stopScheduleRun(task.id, run.id, owner, run.at + 9000), frozen)
  assert.deepEqual(events, ['run.finished'], 'retry never emits a second terminal result')
})

test('Stop cannot redirect onto newer work, publish a late result, or grant a shared reader ownership', t => {
  const task = fixture()
  t.after(() => store.removeSchedule(task.id))
  const first = store.runSchedule(task.id)!
  const grant = store.createGrant({ subject: { kind: 'schedule', id: task.id }, audience: { kind: 'org', orgId: 'tenant-beta' }, tier: 'view' }, owner)
  assert.ok(grant)
  t.after(() => store.revokeGrant(grant.id, owner))
  assert.equal(store.scheduleVisibleToTenant(task, 'tenant-beta'), true)
  assert.equal(store.stopScheduleRun(task.id, first.id, 'tenant-beta'), undefined)
  assert.equal(store.stopScheduleRun(task.id, first.id, 'tenant-harbor'), undefined)
  assert.equal(first.status, 'running')
  store.stopScheduleRun(task.id, first.id, owner)
  const next = store.runSchedule(task.id)!
  assert.notEqual(next.id, first.id)
  assert.equal(store.stopScheduleRun(task.id, first.id, owner)?.status, 'cancelled')
  assert.equal(next.status, 'running')
  assert.equal(store.completeScheduleRun(task.id, first.id, { id: 'late', role: 'assistant', content: 'Late result' },
    { agentId: 'late-agent', providerId: 'late-provider' }), undefined)
  assert.equal(store.failScheduleRun(task.id, first.id, 'execution_error', 'Late failure'), undefined)
  assert.equal(store.deferScheduleRun(task.id, first.id, Date.now(), 'Late retry'), undefined)
  assert.equal(store.markScheduleRunAttempt(task.id, first.id, 2), undefined)
  assert.equal(first.status, 'cancelled')
  assert.doesNotMatch(JSON.stringify(store.getSession(runSessionId(task.id, first.id))), /Late result|Late failure/)
  store.stopScheduleRun(task.id, next.id, owner)
})

test('completion that wins the Stop race stays completed and missing exact run stays missing', t => {
  const task = fixture()
  t.after(() => store.removeSchedule(task.id))
  const run = store.runSchedule(task.id)!
  const context = store.routineExecutionContext(task.id, run.id)!
  store.completeScheduleRun(task.id, run.id, { id: 'result', role: 'assistant', content: 'Known completed result' },
    { agentId: context.agent.id, providerId: context.provider.id })
  const frozen = structuredClone(run)
  assert.equal(run.status, 'ok')
  assert.deepEqual(store.stopScheduleRun(task.id, run.id, owner), frozen)
  assert.equal(store.stopScheduleRun(task.id, 'missing-run', owner), undefined)
  assert.equal(store.stopScheduleRun('missing-routine', run.id, owner), undefined)
})

test('Stop before the deferred enqueue reaches the real worker never admits model work', async t => {
  const task = fixture()
  let modelCalls = 0
  const runner = createRoutineRunner(store, async () => { modelCalls++; throw new Error('Stopped work reached the model') })
  t.after(() => { runner.stop(); configureScheduleExecutor(undefined); store.removeSchedule(task.id) })
  configureScheduleExecutor(runner.enqueue, runner.cancel)
  const run = store.runSchedule(task.id)!
  store.stopScheduleRun(task.id, run.id, owner)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(modelCalls, 0)
  assert.equal(run.attempts, 0)
  assert.equal(run.status, 'cancelled')
})
