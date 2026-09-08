/** Scheduled artifact output is one durable compound act: the routine's terminal
 * run, metadata, and ID-keyed authored body must commit together before a live
 * subscriber can observe them.  This suite drives real JSON and SQLite stores in
 * fresh child processes so restart and the one-way persistence wall are real. */
import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { saveState } from './persist.ts'

const ROOT = mkdtempSync(join(tmpdir(), `agent-commons-schedule-artifacts-${process.pid}-`))
const storeModule = new URL('../store/index.ts', import.meta.url).href
const persistenceModule = new URL('./persist.ts', import.meta.url).href
const runSessionModule = new URL('../../contract/ids.ts', import.meta.url).href

after(() => rmSync(ROOT, { recursive: true, force: true }))

function boot(file: string, backend: 'json' | 'sqlite', work = '') {
  const script = `
    const { store } = await import(${JSON.stringify(storeModule)});
    const { loadState, saveState, closePersistence } = await import(${JSON.stringify(persistenceModule)});
    const { runSessionId } = await import(${JSON.stringify(runSessionModule)});
    store.initPersistence();
    ${work}
    closePersistence();
  `
  return spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
    encoding: 'utf8',
    timeout: 20_000,
    env: {
      ...process.env,
      INITIAL_WORLD: 'clean',
      BACKEND: 'mock',
      PERSIST_BACKEND: backend,
      DATA_FILE: file,
      DATABASE_PATH: file,
    },
  })
}

function ok(result: ReturnType<typeof boot>): Record<string, any> {
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim() ? JSON.parse(result.stdout) : {}
}

const taskSeed = `{
  name: 'Durable schedule artifact',
  cadence: 'Daily · 9:00 AM',
  next: 'tomorrow',
  enabled: false,
  lastStatus: 'pending',
  subtitle: 'Writes one durable digest.',
  trigger: 'Run the digest.',
  prompt: 'Write the digest.',
  steps: [],
  delivery: { tool: { id: 'claude', label: 'Claude', tone: 'claude' }, target: 'Run conversation' },
  runs: [],
  model: 'Claude Opus 4.8',
}`

for (const backend of ['json', 'sqlite'] as const) {
  test(`${backend}: routine output creates and refreshes one ID-keyed authored artifact across restart`, () => {
    const file = join(ROOT, `schedule-artifact-${backend}`)
    const first = ok(boot(file, backend, `
      const task = store.addSchedule({ ...${taskSeed}, tenantId: 'tenant-routine-owner' }, 'schedule-artifact-test');
      store.applyRelationOp({ kind: 'set-schedule-artifact', scheduleId: task.id, scheduleName: task.name, cadence: task.cadence, artifactName: 'digest.md' }, 'tenant-routine-owner');
      const observed = [];
      const run = store.runSchedule(task.id, { manualRunId: 'run-schedule-first' });
      const ctx = store.routineExecutionContext(task.id, run.id);
      store.markScheduleRunAttempt(task.id, run.id, 1, run.at + 10);
      const unsubscribe = store.subscribe(event => {
        if (event.type === 'artifact.changed' || event.type === 'relation.applied' || event.type === 'session.updated' || event.type === 'run.finished') {
          const state = loadState();
          const artifact = state?.graph.extraArtifacts.find(a => a.sourceScheduleId === task.id);
          const run = state?.schedules.find(t => t.id === task.id)?.runs.find(r => r.id === 'run-schedule-first');
          const body = artifact && state?.artifactBodies?.find(([id]) => id === artifact.id)?.[1];
          observed.push({ event: event.type, committed: run?.status === 'ok' && artifact?.sourceScheduleId === task.id && body?.type === 'doc' && body.blocks[0]?.p === 'First durable digest.' });
        }
      });
      store.completeScheduleRun(task.id, run.id, { id: 'model-first', role: 'assistant', content: 'First durable digest.' }, { agentId: ctx.agent.id, providerId: ctx.provider.id, ...(ctx.modelId ? { modelId: ctx.modelId } : {}) }, run.at + 100);
      unsubscribe();
      const artifact = store.listArtifacts('tenant-routine-owner').find(a => a.sourceScheduleId === task.id);
      const body = artifact && store.artifactContent('tenant-routine-owner')[artifact.id];
      console.log(JSON.stringify({ taskId: task.id, artifactId: artifact?.id, artifact, body, observed, state: loadState() }));
    `))
    const artifact = first.artifact
    assert.ok(artifact, `${backend}: first successful run creates an artifact`)
    assert.equal(artifact.sourceScheduleId, 'schedule-artifact-test')
    assert.equal(artifact.tenantId, 'tenant-routine-owner', 'routine output is owned by task.tenantId')
    assert.equal(artifact.sourceSessionId, 'srun-schedule-artifact-test-run-schedule-first')
    assert.equal(first.body?.type, 'doc')
    assert.deepEqual(first.body?.blocks, [{ p: 'First durable digest.' }])
    assert.deepEqual(first.observed.map((row: any) => row.event), ['artifact.changed', 'relation.applied', 'session.updated', 'run.finished'])
    assert.ok(first.observed.every((row: any) => row.committed), 'terminal subscribers see committed body + metadata + run')

    const second = ok(boot(file, backend, `
      const task = store.listSchedules('tenant-routine-owner').find(t => t.id === 'schedule-artifact-test');
      const before = store.listArtifacts('tenant-routine-owner').find(a => a.sourceScheduleId === task.id);
      const run = store.runSchedule(task.id, { manualRunId: 'run-schedule-second' });
      const ctx = store.routineExecutionContext(task.id, run.id);
      store.markScheduleRunAttempt(task.id, run.id, 1, run.at + 10);
      store.completeScheduleRun(task.id, run.id, { id: 'model-second', role: 'assistant', content: 'Second durable digest.' }, { agentId: ctx.agent.id, providerId: ctx.provider.id, ...(ctx.modelId ? { modelId: ctx.modelId } : {}) }, run.at + 100);
      const artifacts = store.listArtifacts('tenant-routine-owner').filter(a => a.sourceScheduleId === task.id);
      const current = artifacts[0];
      console.log(JSON.stringify({ count: artifacts.length, beforeRevision: store.artifactContent('tenant-routine-owner')[before.id]?.revision, artifact: current, body: store.artifactContent('tenant-routine-owner')[current.id], state: loadState() }));
    `))
    assert.equal(second.count, 1, `${backend}: second run refreshes rather than duplicates`)
    assert.equal(second.artifact.id, artifact.id, `${backend}: the schedule binding remains ID-stable`)
    assert.equal(second.artifact.sourceSessionId, 'srun-schedule-artifact-test-run-schedule-second')
    assert.equal(second.body?.revision, (first.body?.revision ?? 0) + 1)
    assert.deepEqual(second.body?.blocks, [{ p: 'Second durable digest.' }])
    assert.ok(second.state?.graph.extraArtifacts.some((a: any) => a.id === artifact.id && a.sourceScheduleId === 'schedule-artifact-test'))
  })

  test(`${backend}: empty routine output does not replace the prior artifact body`, () => {
    const file = join(ROOT, `schedule-artifact-empty-${backend}`)
    const result = ok(boot(file, backend, `
      const task = store.addSchedule({ ...${taskSeed}, tenantId: 'tenant-empty-owner' }, 'schedule-empty-artifact-test');
      store.applyRelationOp({ kind: 'set-schedule-artifact', scheduleId: task.id, scheduleName: task.name, cadence: task.cadence, artifactName: 'digest.md' }, 'tenant-empty-owner');
      const first = store.runSchedule(task.id, { manualRunId: 'run-empty-first' });
      const ctx = store.routineExecutionContext(task.id, first.id);
      store.completeScheduleRun(task.id, first.id, { id: 'model-first', role: 'assistant', content: 'Keep this digest.' }, { agentId: ctx.agent.id, providerId: ctx.provider.id, ...(ctx.modelId ? { modelId: ctx.modelId } : {}) });
      const before = store.listArtifacts('tenant-empty-owner').find(a => a.sourceScheduleId === task.id);
      const beforeBody = store.artifactContent('tenant-empty-owner')[before.id];
      const second = store.runSchedule(task.id, { manualRunId: 'run-empty-second' });
      const ctx2 = store.routineExecutionContext(task.id, second.id);
      store.markScheduleRunAttempt(task.id, second.id, 1, second.at + 10);
      const completed = store.completeScheduleRun(task.id, second.id, { id: 'model-empty', role: 'assistant', content: '   ' }, { agentId: ctx2.agent.id, providerId: ctx2.provider.id });
      const current = store.listArtifacts('tenant-empty-owner').find(a => a.sourceScheduleId === task.id);
      const persistedRun = loadState()?.schedules.find(t => t.id === task.id)?.runs.find(r => r.id === second.id);
      console.log(JSON.stringify({ status: completed?.status, failureCode: completed?.failureCode, count: store.listArtifacts('tenant-empty-owner').filter(a => a.sourceScheduleId === task.id).length, before, beforeBody, current, body: store.artifactContent('tenant-empty-owner')[current.id], run: persistedRun }));
    `))
    assert.equal(result.status, 'failed', `${backend}: empty output is a terminal artifact failure`)
    assert.equal(result.failureCode, 'execution_error')
    assert.equal(result.count, 1)
    assert.equal(result.current.id, result.before.id)
    assert.deepEqual(result.body?.blocks, [{ p: 'Keep this digest.' }])
    assert.equal(result.body?.revision, result.beforeBody?.revision)
  })
}

test('a failed artifact commit publishes no terminal/standing event, preserves the prior file, and latches storage unhealthy', () => {
  const file = join(ROOT, 'schedule-artifact-failure-json')
  ok(boot(file, 'json', `
    const task = store.addSchedule({ ...${taskSeed}, tenantId: 'tenant-failure-owner' }, 'schedule-failure-artifact-test');
    store.applyRelationOp({ kind: 'set-schedule-artifact', scheduleId: task.id, scheduleName: task.name, cadence: task.cadence, artifactName: 'digest.md' }, 'tenant-failure-owner');
    const first = store.runSchedule(task.id, { manualRunId: 'run-failure-first' });
    const ctx = store.routineExecutionContext(task.id, first.id);
    store.completeScheduleRun(task.id, first.id, { id: 'model-first', role: 'assistant', content: 'Original durable digest.' }, { agentId: ctx.agent.id, providerId: ctx.provider.id });
  `))
  const before = JSON.parse(readFileSync(file, 'utf8'))
  const blocked = join(ROOT, 'blocked-failure-path')
  mkdirSync(blocked, { recursive: true })
  const result = boot(file, 'json', `
    const task = store.listSchedules('tenant-failure-owner').find(t => t.id === 'schedule-failure-artifact-test');
    const run = store.runSchedule(task.id, { manualRunId: 'run-failure-second' });
    const ctx = store.routineExecutionContext(task.id, run.id);
    store.markScheduleRunAttempt(task.id, run.id, 1, run.at + 10);
    const events = [];
    const unsubscribe = store.subscribe(event => { if (event.type === 'artifact.changed' || event.type === 'relation.applied' || event.type === 'session.updated' || event.type === 'run.finished') events.push(event.type); });
    process.env.DATA_FILE = ${JSON.stringify(blocked)};
    let failed = false;
    try { store.completeScheduleRun(task.id, run.id, { id: 'model-second', role: 'assistant', content: 'Must not commit.' }, { agentId: ctx.agent.id, providerId: ctx.provider.id }); } catch { failed = true; }
    unsubscribe();
    console.log(JSON.stringify({ failed, events, healthy: store.persistenceHealthy() }));
  `)
  assert.equal(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)
  assert.equal(report.failed, true, 'the failed commit is rejected')
  assert.deepEqual(report.events, [], 'the failed commit publishes no terminal/standing event')
  assert.equal(report.healthy, false, 'the failed child latches its persistence fault')
  const after = JSON.parse(readFileSync(file, 'utf8'))
  assert.deepEqual(after.graph.extraArtifacts, before.graph.extraArtifacts, 'the failed commit leaves the prior artifact metadata intact')
  assert.deepEqual(after.artifactBodies, before.artifactBodies, 'the failed commit leaves the prior artifact body intact')
})

test('restart upgrades a legacy metadata-only scheduled artifact by its retained run join without duplicating it', () => {
  const file = join(ROOT, 'schedule-artifact-legacy-upgrade')
  const first = ok(boot(file, 'json', `
    const task = store.addSchedule({ ...${taskSeed} }, 'schedule-legacy-artifact-test');
    store.applyRelationOp({ kind: 'set-schedule-artifact', scheduleId: task.id, scheduleName: task.name, cadence: task.cadence, artifactName: 'digest.md' });
    const run = store.runSchedule(task.id, { manualRunId: 'run-legacy-first' });
    store.applyRelationOp({
      kind: 'save-artifact',
      artifact: { name: 'digest.md', kind: 'doc', meta: 'Saved by Durable schedule artifact' },
      sessionId: runSessionId(task.id, run.id),
      sessionTitle: 'Scheduled run of ' + task.name,
      ownerTenantId: 'tenant-personal',
    });
    store.failScheduleRun(task.id, run.id, 'execution_error', 'Historical metadata-only save.');
    const state = loadState();
    const legacy = state.graph.extraArtifacts.find(a => a.name === 'digest.md' && a.sourceSessionId === runSessionId(task.id, run.id));
    if (!legacy) throw new Error('metadata-only historical delivery was not created');
    saveState({
      ...state,
      graph: {
        ...state.graph,
        extraArtifacts: state.graph.extraArtifacts.map(a => a.id === legacy.id ? { ...a, tenantId: undefined, sourceScheduleId: undefined } : a),
      },
      artifactBodies: [],
    });
    console.log(JSON.stringify({ artifactId: legacy.id, sourceSessionId: legacy.sourceSessionId }));
  `))
  assert.ok(first.artifactId)
  const second = ok(boot(file, 'json', `
    const task = store.listSchedules().find(t => t.id === 'schedule-legacy-artifact-test');
    const run = store.runSchedule(task.id, { manualRunId: 'run-legacy-second' });
    const ctx = store.routineExecutionContext(task.id, run.id);
    store.completeScheduleRun(task.id, run.id, { id: 'model-legacy-second', role: 'assistant', content: 'Recovered scheduled digest.' }, { agentId: ctx.agent.id, providerId: ctx.provider.id });
    const artifacts = store.listArtifacts().filter(a => a.sourceScheduleId === task.id);
    const artifact = artifacts[0];
    const state = loadState();
    const body = state.artifactBodies.find(([id]) => id === artifact.id)?.[1];
    console.log(JSON.stringify({ count: artifacts.length, artifact, body, state }));
  `))
  assert.equal(second.count, 1)
  assert.equal(second.artifact.id, first.artifactId, `the retained metadata row is adopted, not duplicated: ${JSON.stringify(second)}`)
  assert.equal(second.artifact.sourceScheduleId, 'schedule-legacy-artifact-test')
  assert.equal(second.artifact.tenantId, 'tenant-personal', 'rehydrate and delivery stamp the default owner')
  assert.equal(second.artifact.sourceSessionId, 'srun-schedule-legacy-artifact-test-run-legacy-second')
  assert.deepEqual(second.body?.blocks, [{ p: 'Recovered scheduled digest.' }])
  assert.equal(second.body?.revision, 1, 'adopting an existing metadata row records the authored body as its first update')
})
