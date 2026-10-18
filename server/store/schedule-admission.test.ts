/** Scheduled admission failures are durable occurrences, not scheduler crashes.
 * Exercise the real store and scheduler without a worker or provider I/O. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_PROVIDER_ID, type ScheduledTask } from '../../contract/index.ts'
import { runSessionId } from '../../contract/ids.ts'
import { ValidationError } from '../conflict.ts'
import { PersistenceWriteError } from '../persistence/persist.ts'
import { runSchedulerPass, type SchedulerPort } from '../scheduler.ts'
import { configureScheduleExecutor, store } from './index.ts'

let sequence = 0
const MODEL = 'schedule-admission-model'

function fixture() {
  const tenantId = `tenant-schedule-admission-${++sequence}`
  const provider = store.createProvider({ label: `Admission provider ${sequence}`, modelFamily: 'custom',
    effortLevels: ['Low', 'High'], models: [{ id: MODEL, label: 'Admission model', effortLevels: ['Low', 'High'] }] },
  { model: MODEL }, tenantId)
  // The Routine's explicit provider is independent of its Agent's provider, so
  // ordinary provider deletion can leave the Routine's selection unavailable.
  const agent = store.createAgent({ label: `Admission Agent ${sequence}`, systemPrompt: 'Complete the task.',
    tools: [], instructions: '', providerId: DEFAULT_PROVIDER_ID }, tenantId)
  const makeTask = (name: string, binding: Partial<ScheduledTask> = {}) => store.addSchedule({
    tenantId, name, cadence: 'Every hour', timezone: 'UTC', next: '', enabled: true, lastStatus: 'pending',
    subtitle: 'Admission regression', trigger: '', prompt: 'Produce the reviewed result.', steps: [],
    delivery: { tool: { id: 'claude', label: 'Claude', tone: 'claude' }, target: 'Run conversation' },
    runs: [], model: '', agentId: agent.id, providerId: DEFAULT_PROVIDER_ID, ...binding,
  })
  // addSchedule inserts newest first: the invalid Routine must be visited before
  // the healthy sibling to prove its refusal cannot abort the remaining pass.
  const healthy = makeTask('Healthy admission sibling')
  const task = makeTask('Stale admission binding', { providerId: provider.id, modelId: MODEL, effort: 'High' })
  const scheduledFor = task.nextFireAt!
  const now = scheduledFor + 100
  const port: SchedulerPort = {
    listSchedules: () => store.listSchedules(tenantId),
    runSchedule: (...args) => store.runSchedule(...args),
    recordSkippedScheduleFire: (...args) => store.recordSkippedScheduleFire(...args),
    setScheduleNextFire: (...args) => store.setScheduleNextFire(...args),
    reapStaleRunners: (...args) => store.reapStaleRunners(...args),
  }
  return { tenantId, provider, agent, task, healthy, port, scheduledFor, now, close() {
    configureScheduleExecutor(undefined)
    store.removeSchedule(task.id)
    store.removeSchedule(healthy.id)
    store.deleteAgent(agent.id)
    store.deleteProvider(provider.id)
  } }
}

const changes = [
  { name: 'deleted Agent', invalidate: (f: ReturnType<typeof fixture>) => {
    // Give the healthy sibling an independent Agent before removing this one.
    store.updateSchedule(f.healthy.id, { agentId: 'agent-default' })
    assert.equal(store.deleteAgent(f.agent.id), true)
  }, detail: /No Agent .* is available to this routine/ },
  { name: 'deleted selected provider', invalidate: (f: ReturnType<typeof fixture>) => {
    assert.equal(store.deleteProvider(f.provider.id), true)
  }, detail: /No endpoint provider .* is available to this routine/ },
  { name: 'removed selected model', invalidate: (f: ReturnType<typeof fixture>) => {
    store.replaceStaticProviderModels(f.provider.id, [{ id: 'replacement-model', label: 'Replacement model' }])
  }, detail: /lists no model 'schedule-admission-model'/ },
  { name: 'removed effort choice', invalidate: (f: ReturnType<typeof fixture>) => {
    store.replaceStaticProviderModels(f.provider.id, [{ id: MODEL, label: 'Admission model', effortLevels: ['Low'] }])
  }, detail: /does not offer effort 'High'/ },
]

for (const change of changes) {
  test(`due Routine with ${change.name} fails once without stopping healthy scheduled work`, async (t) => {
    const f = fixture()
    const enqueued: Array<{ taskId: string; runId: string }> = []
    configureScheduleExecutor((taskId, runId) => { enqueued.push({ taskId, runId }) })
    try {
      change.invalidate(f)
      const usageBefore = structuredClone(store.usage(undefined, f.tenantId).limits)
      const revision = f.task.revision
      const sessionsBefore = store.listSessions(f.tenantId).length
      const events: string[] = []
      const unsubscribe = store.subscribe(event => {
        if ('taskId' in event && event.taskId === f.task.id) events.push(event.type)
      })
      t.after(unsubscribe)
      let admissionError: unknown
      try { store.runSchedule(f.task.id) } catch (error) { admissionError = error }
      assert.ok(admissionError instanceof ValidationError, 'manual Run now retains its explicit admission refusal')
      assert.match(admissionError.message, change.detail)
      const admissionDetail = admissionError.message
      assert.equal(f.task.runs.length, 0, 'manual refusal does not create run history')
      assert.equal(store.listSessions(f.tenantId).length, sessionsBefore, 'manual refusal does not create a run conversation')
      assert.deepEqual(events, [], 'manual refusal publishes no run or definition change')

      assert.doesNotThrow(() => runSchedulerPass(f.port, { now: f.now }))
      await Promise.resolve() // queued worker handoffs happen only after the mutation commits
      unsubscribe()

      assert.equal(f.task.enabled, false, 'repair is required before this Routine can run again')
      assert.equal(f.task.nextFireAt, undefined, 'the scheduler must not restore a paused Routine cursor')
      assert.equal(f.task.lastStatus, 'failed')
      assert.equal(f.task.revision, (revision ?? 0) + 1, 'automatic pause is a visible definition change')
      assert.equal(f.task.runs.length, 1)
      const failed = f.task.runs[0]!
      assert.equal(failed.status, 'failed')
      assert.equal(failed.scheduledFor, f.scheduledFor)
      assert.equal(failed.at, f.now)
      assert.equal(failed.attempts, 0, 'admission failure never attempts provider work')
      assert.equal(failed.nextAttemptAt, undefined)
      assert.ok(failed.detail?.includes(admissionDetail), 'the saved failure explains the actual invalid binding')
      assert.ok(failed.failureCode, 'a scheduled refusal retains a typed terminal cause')
      const session = store.getSession(runSessionId(f.task.id, failed.id))!
      assert.ok(session, 'the failed occurrence remains inspectable in its ordinary run conversation')
      assert.ok(session.messages?.some(message => message.role === 'assistant' && message.content.includes(admissionDetail)))
      assert.deepEqual(enqueued, [{ taskId: f.healthy.id, runId: f.healthy.runs[0]!.id }],
        'only the healthy sibling reaches the worker')
      assert.equal(f.healthy.runs[0]?.status, 'running')
      assert.ok(f.healthy.nextFireAt! > f.now)
      assert.deepEqual(store.usage(undefined, f.tenantId).limits, usageBefore, 'admission failure spends no tokens')
      assert.ok(events.includes('run.finished'), 'readers receive the terminal occurrence')
      assert.ok(events.includes('schedule.changed'), 'readers receive the automatic pause')

      const failedBefore = structuredClone(failed)
      const replay = store.runSchedule(f.task.id, { scheduledFor: f.scheduledFor, startedAt: f.now + 1_000 })
      assert.equal(replay?.id, failed.id, 'the represented scheduled occurrence replays before admission')
      runSchedulerPass(f.port, { now: f.now + 1_000 })
      await Promise.resolve()
      assert.equal(f.task.runs.length, 1)
      assert.deepEqual(f.task.runs[0], failedBefore)
      assert.equal(enqueued.length, 1, 'repeat passes and exact replay dispatch no additional work')
      assert.throws(() => store.runSchedule(f.task.id), error => error instanceof ValidationError && error.message === admissionDetail)
      assert.equal(f.task.runs.length, 1, 'manual refusal after the failed occurrence adds no history')
    } finally { f.close() }
  })
}

for (const fault of [new Error('Unexpected admission fault'), new PersistenceWriteError(new Error('Storage fault'))]) {
  test(`scheduler and store propagate ${fault.name} instead of treating it as invalid Routine configuration`, () => {
    const f = fixture()
    const originalAgentId = f.task.agentId
    try {
      Object.defineProperty(f.task, 'agentId', { configurable: true, enumerable: true, get: () => { throw fault } })
      assert.throws(() => runSchedulerPass(f.port, { now: f.now }), error => error === fault)
      assert.equal(f.task.enabled, true)
      assert.equal(f.task.nextFireAt, f.scheduledFor)
      assert.equal(f.task.runs.length, 0, 'an operational fault must not fabricate a terminal occurrence')
      assert.equal(f.healthy.runs.length, 0, 'a process fault must escape the pass')
    } finally {
      Object.defineProperty(f.task, 'agentId', { configurable: true, enumerable: true, writable: true, value: originalAgentId })
      f.close()
    }
  })
}
