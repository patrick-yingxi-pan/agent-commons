/** A refused scheduled occurrence and its automatic pause share one durable
 * transaction. Fresh processes exercise both actual persistence backends. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

const root = mkdtempSync(join(tmpdir(), 'agent-commons-schedule-admission-'))
const storeModule = new URL('../store/index.ts', import.meta.url).href
const persistModule = new URL('./persist.ts', import.meta.url).href
const schedulerModule = new URL('../scheduler.ts', import.meta.url).href
after(() => rmSync(root, { recursive: true, force: true }))

function child(script: string, file: string, backend: 'json' | 'sqlite') {
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
    encoding: 'utf8', timeout: 30_000,
    env: { ...process.env, INITIAL_WORLD: 'clean', DEPLOYMENT_PROFILE: '', BACKEND: 'mock',
      PERSIST_BACKEND: backend, DATA_FILE: file, DATABASE_PATH: file },
  })) as any
}

const imports = `
  const { store, configureScheduleExecutor } = await import(${JSON.stringify(storeModule)});
  const { loadState, closePersistence, PersistenceWriteError } = await import(${JSON.stringify(persistModule)});
  const { runSchedulerPass } = await import(${JSON.stringify(schedulerModule)});
  const owner = 'tenant-personal';
  const port = {
    listSchedules: () => store.listSchedules(owner),
    runSchedule: (...args) => store.runSchedule(...args),
    recordSkippedScheduleFire: (...args) => store.recordSkippedScheduleFire(...args),
    setScheduleNextFire: (...args) => store.setScheduleNextFire(...args),
    reapStaleRunners: (...args) => store.reapStaleRunners(...args),
  };
  let workerCalls = 0;
  configureScheduleExecutor(() => { workerCalls++; });
  store.initPersistence();
`

function setup(notifyOnFailure: boolean) {
  return `
    const agent = store.createAgent({ label: 'Removed scheduled Agent', systemPrompt: 'Complete the task.',
      tools: [], instructions: '', providerId: 'provider-anthropic' }, owner);
    const task = store.addSchedule({ tenantId: owner, name: 'Persisted admission refusal',
      cadence: 'Every hour', timezone: 'UTC', next: '', enabled: true, lastStatus: 'pending',
      subtitle: 'Persistence regression', trigger: '', prompt: 'Produce the reviewed result.', steps: [],
      delivery: { tool: { id: 'claude', label: 'Claude', tone: 'claude' }, target: 'Run conversation' },
      runs: [], model: '', agentId: agent.id, providerId: 'provider-anthropic', notifyOnFailure: ${notifyOnFailure} });
    store.deleteAgent(agent.id);
    const scheduledFor = task.nextFireAt;
    const now = scheduledFor + 100;
  `
}

for (const backend of ['json', 'sqlite'] as const) {
  for (const notifyOnFailure of [true, false]) {
    test(`${backend}: zero-attempt scheduled refusal, pause and notification=${notifyOnFailure} survive reload without replay`, () => {
      const file = join(root, `refused-${notifyOnFailure}.${backend === 'json' ? 'json' : 'db'}`)
      const created = child(`${imports}
        ${setup(notifyOnFailure)}
        const usageBefore = loadState().usageMeters;
        const observed = [];
        const unsubscribe = store.subscribe(event => {
          if (!('taskId' in event) || event.taskId !== task.id ||
              !['schedule.changed', 'run.finished'].includes(event.type)) return;
          const state = loadState();
          const saved = state.schedules.find(row => row.id === task.id);
          const run = saved?.runs[0];
          const session = state.sessions.find(row => row.id === 'srun-' + task.id + '-' + run?.id);
          observed.push({ type: event.type, committed: saved?.enabled === false &&
            saved.nextFireAt === undefined && run?.status === 'failed' && run.attempts === 0 &&
            session?.messages.some(message => message.role === 'assistant' && message.content.includes(run.detail)) });
        });
        runSchedulerPass(port, { now });
        await Promise.resolve();
        unsubscribe();
        const state = loadState();
        const saved = state.schedules.find(row => row.id === task.id);
        const session = state.sessions.find(row => row.id === 'srun-' + task.id + '-' + saved.runs[0].id);
        const notifications = store.listNotifications(owner).filter(row => row.scheduleId === task.id);
        const report = { task: saved, session, notifications, observed, scheduledFor, now, workerCalls,
          usageUnchanged: JSON.stringify(state.usageMeters) === JSON.stringify(usageBefore),
          pending: store.pendingScheduleRuns() };
        closePersistence();
        console.log(JSON.stringify(report));
      `, file, backend)

      assert.equal(created.task.enabled, false)
      assert.equal(created.task.nextFireAt, undefined)
      assert.equal(created.task.revision, 1)
      assert.equal(created.task.lastStatus, 'failed')
      assert.equal(created.task.runs.length, 1)
      const run = created.task.runs[0]
      assert.equal(run.status, 'failed')
      assert.equal(run.attempts, 0)
      assert.equal(run.at, created.now)
      assert.equal(run.scheduledFor, created.scheduledFor)
      assert.equal(run.nextAttemptAt, undefined)
      assert.equal(run.execution, undefined, 'a refused occurrence invents no validated execution tuple')
      assert.match(run.detail, /before any model or tool work/)
      assert.match(run.detail, /No Agent .* is available to this routine/)
      assert.equal(created.session.messages.filter((message: any) => message.role === 'assistant').length, 1)
      assert.ok(created.session.messages.some((message: any) => message.content.includes(run.detail)))
      assert.equal(created.notifications.length, notifyOnFailure ? 1 : 0)
      if (notifyOnFailure) assert.deepEqual({ kind: created.notifications[0].kind, runId: created.notifications[0].runId },
        { kind: 'schedule.failed', runId: run.id })
      assert.deepEqual(created.observed.map((event: any) => event.type).sort(), ['run.finished', 'schedule.changed'])
      assert.ok(created.observed.every((event: any) => event.committed), 'events observe the already committed terminal snapshot')
      assert.equal(created.workerCalls, 0)
      assert.equal(created.usageUnchanged, true)
      assert.deepEqual(created.pending, [])

      const reboot = child(`${imports}
        const taskId = ${JSON.stringify(created.task.id)};
        const scheduledFor = ${created.scheduledFor};
        const before = loadState();
        const events = [];
        const unsubscribe = store.subscribe(event => { if ('taskId' in event && event.taskId === taskId) events.push(event.type); });
        runSchedulerPass(port, { now: ${created.now + 1_000}, booting: true });
        const replay = store.runSchedule(taskId, { scheduledFor, startedAt: ${created.now + 2_000} });
        await Promise.resolve();
        unsubscribe();
        const state = loadState();
        const task = state.schedules.find(row => row.id === taskId);
        const session = state.sessions.find(row => row.id === ${JSON.stringify(created.session.id)});
        const notifications = store.listNotifications(owner).filter(row => row.scheduleId === taskId);
        const report = { task, session, notifications, replay, events, workerCalls,
          unchanged: JSON.stringify(state) === JSON.stringify(before), pending: store.pendingScheduleRuns() };
        closePersistence();
        console.log(JSON.stringify(report));
      `, file, backend)
      assert.deepEqual(reboot.task, created.task, 'reload preserves exact history and the cleared cursor')
      assert.deepEqual(reboot.session, created.session, 'reload does not duplicate or rewrite the failure recap')
      assert.deepEqual(reboot.notifications, created.notifications, 'reload and exact replay cannot add another alert')
      assert.deepEqual(reboot.replay, run)
      assert.equal(reboot.workerCalls, 0)
      assert.equal(reboot.unchanged, true)
      assert.deepEqual(reboot.events, [])
      assert.deepEqual(reboot.pending, [])
    })
  }
}

test('failed admission commit propagates storage failure before publishing the pause, run or worker handoff', () => {
  const file = join(root, 'failed-admission.json')
  const blocked = join(root, 'blocked-admission-path')
  mkdirSync(blocked)
  const result = child(`${imports}
    ${setup(true)}
    const before = loadState();
    const events = [];
    const unsubscribe = store.subscribe(event => {
      if (event.type === 'run.finished' || event.type === 'run.started' || event.type === 'schedule.changed') events.push(event.type);
    });
    process.env.DATA_FILE = ${JSON.stringify(blocked)};
    let failure;
    try { runSchedulerPass(port, { now }); } catch (error) {
      failure = { name: error.name, storageError: error instanceof PersistenceWriteError };
    }
    await Promise.resolve();
    unsubscribe();
    process.env.DATA_FILE = ${JSON.stringify(file)};
    const durable = loadState();
    const report = { failure, workerCalls, events, healthy: store.persistenceHealthy(),
      unchanged: JSON.stringify(durable) === JSON.stringify(before),
      durableTask: durable.schedules.find(row => row.id === task.id),
      durableNotifications: durable.notifications.filter(row => row.scheduleId === task.id) };
    closePersistence();
    console.log(JSON.stringify(report));
  `, file, 'json')
  assert.deepEqual(result.failure, { name: 'PersistenceWriteError', storageError: true })
  assert.equal(result.healthy, false, 'the failed commit retains the existing process-wide storage wall')
  assert.equal(result.workerCalls, 0)
  assert.deepEqual(result.events, [])
  assert.equal(result.unchanged, true, 'the previous durable snapshot remains authoritative')
  assert.equal(result.durableTask.enabled, true)
  assert.ok(Number.isFinite(result.durableTask.nextFireAt))
  assert.deepEqual(result.durableTask.runs, [])
  assert.deepEqual(result.durableNotifications, [])
})
