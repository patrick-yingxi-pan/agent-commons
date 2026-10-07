/** Typed routine-output intent is durable in both backends. Historical names
 * remain Documents, while a malformed present kind/shape stops startup. */
import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { docBlockId } from '../documentIdentity.ts'

const ROOT = mkdtempSync(join(tmpdir(), `agent-commons-scheduled-artifact-spec-${process.pid}-`))
const storeModule = new URL('../store/index.ts', import.meta.url).href
const persistenceModule = new URL('./persist.ts', import.meta.url).href

after(() => rmSync(ROOT, { recursive: true, force: true }))

function boot(file: string, backend: 'json' | 'sqlite', work = '') {
  return spawnSync(process.execPath, ['--input-type=module', '--eval', `
    const { store } = await import(${JSON.stringify(storeModule)});
    const { loadState, saveState, closePersistence } = await import(${JSON.stringify(persistenceModule)});
    store.initPersistence();
    ${work}
    closePersistence();
  `], {
    encoding: 'utf8', timeout: 20_000,
    env: { ...process.env, INITIAL_WORLD: 'clean', BACKEND: 'mock', PERSIST_BACKEND: backend, DATA_FILE: file, DATABASE_PATH: file },
  })
}

function ok(result: ReturnType<typeof boot>): Record<string, any> {
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim() ? JSON.parse(result.stdout) : {}
}

const seed = `{
  name: 'Typed standing output', cadence: 'Daily · 9:00 AM', next: 'tomorrow', enabled: false,
  lastStatus: 'pending', subtitle: 'Typed output.', trigger: 'Run.', prompt: 'Produce output.', steps: [],
  delivery: { tool: { id: 'claude', label: 'Claude', tone: 'claude' }, target: 'Run conversation' },
  runs: [], model: 'Claude Opus 4.8', tenantId: 'tenant-standing-owner',
}`

for (const backend of ['json', 'sqlite'] as const) {
  test(`${backend}: a legacy graph name queues as a canonical Document`, () => {
    const file = join(ROOT, `legacy-graph-queue-${backend}`)
    ok(boot(file, backend, `
      const task = store.addSchedule({ ...${seed}, name: 'Legacy graph queue' }, 'legacy-graph-queue');
      const state = loadState();
      state.graph.scheduleArtifact[task.id] = 'legacy.xlsx';
      saveState(state);
    `))
    const queued = ok(boot(file, backend, `
      const run = store.runSchedule('legacy-graph-queue', { manualRunId: 'legacy-graph-run' });
      console.log(JSON.stringify({ standing: run.execution.standing }));
    `))
    assert.deepEqual(queued.standing, { artifact: { name: 'legacy.xlsx', kind: 'doc' }, tools: [] })
  })

  test(`${backend}: a resumed legacy standing run is normalized before execution`, () => {
    const file = join(ROOT, `legacy-runtime-${backend}`)
    ok(boot(file, backend, `
      const task = store.addSchedule({ ...${seed}, name: 'Legacy resumed output' }, 'legacy-runtime');
      store.applyRelationOp({ kind: 'set-schedule-artifact', scheduleId: task.id, scheduleName: task.name, cadence: task.cadence, artifactName: 'legacy.xlsx' }, 'tenant-standing-owner');
      const run = store.runSchedule(task.id, { manualRunId: 'legacy-runtime-run' });
      const state = loadState();
      state.graph.scheduleArtifact[task.id] = 'legacy.xlsx';
      state.schedules.find(row => row.id === task.id).runs.find(row => row.id === run.id).execution.standing = { artifactName: 'legacy.xlsx', tools: [] };
      saveState(state);
    `))
    const resumed = ok(boot(file, backend, `
      const task = store.listSchedules('tenant-standing-owner').find(row => row.id === 'legacy-runtime');
      const run = task.runs.find(row => row.id === 'legacy-runtime-run');
      const context = store.routineExecutionContext(task.id, run.id);
      const completed = store.completeScheduleRun(task.id, run.id,
        { id: 'legacy-runtime-reply', role: 'assistant', content: 'Legacy runtime document.' },
        { agentId: context.agent.id, providerId: context.provider.id }, 20_000);
      const artifact = store.listArtifacts('tenant-standing-owner').find(row => row.sourceScheduleId === task.id);
      console.log(JSON.stringify({ artifactId: artifact.id, standing: run.execution.standing, blocked: context.blocked, status: completed.status,
        kind: artifact.kind, body: store.artifactContent('tenant-standing-owner')[artifact.id] }));
    `))
    assert.deepEqual(resumed.standing, { artifact: { name: 'legacy.xlsx', kind: 'doc' }, tools: [] })
    assert.equal(resumed.blocked, undefined)
    assert.equal(resumed.status, 'ok')
    assert.equal(resumed.kind, 'doc', `${backend}: a legacy filename never selects Sheet`)
    assert.deepEqual(resumed.body.blocks, [{
      id: docBlockId(resumed.artifactId, resumed.body.revision ?? 0, 0),
      p: 'Legacy runtime document.',
    }])
  })

  test(`${backend}: resumed Sheet and Slides runs publish and later refresh body plus run provenance`, () => {
    const file = join(ROOT, `structured-runtime-${backend}`)
    ok(boot(file, backend, `
      for (const kind of ['sheet', 'slide']) {
        const task = store.addSchedule({ ...${seed}, name: 'Runtime ' + kind }, 'runtime-' + kind);
        store.applyRelationOp({ kind: 'set-schedule-artifact', scheduleId: task.id, scheduleName: task.name, cadence: task.cadence,
          artifactName: 'runtime.data', artifactKind: kind }, 'tenant-standing-owner');
        store.runSchedule(task.id, { manualRunId: 'first-' + kind });
      }
    `))
    const first = ok(boot(file, backend, `
      const bodies = {
        sheet: { type: 'sheet', columns: ['Phase'], rows: [['First']] },
        slide: { type: 'slides', slides: [{ title: 'First', bullets: ['Published'] }] },
      };
      const result = {};
      for (const kind of ['sheet', 'slide']) {
        const task = store.listSchedules('tenant-standing-owner').find(row => row.id === 'runtime-' + kind);
        const run = task.runs.find(row => row.id === 'first-' + kind);
        const context = store.routineExecutionContext(task.id, run.id);
        store.completeScheduleRun(task.id, run.id, { id: 'first-reply-' + kind, role: 'assistant', content: 'First recap.' },
          { agentId: context.agent.id, providerId: context.provider.id }, 20_000, bodies[kind]);
        const artifact = store.listArtifacts('tenant-standing-owner').find(row => row.sourceScheduleId === task.id);
        result[kind] = { id: artifact.id, sourceSessionId: artifact.sourceSessionId,
          body: store.artifactContent('tenant-standing-owner')[artifact.id] };
      }
      console.log(JSON.stringify(result));
    `))
    assert.equal(first.sheet.body.type, 'sheet')
    assert.equal(first.slide.body.type, 'slides')

    const refreshed = ok(boot(file, backend, `
      const bodies = {
        sheet: { type: 'sheet', columns: ['Phase'], rows: [['Refreshed']] },
        slide: { type: 'slides', slides: [{ title: 'Refreshed', bullets: ['Current'] }] },
      };
      const result = {};
      for (const kind of ['sheet', 'slide']) {
        const task = store.listSchedules('tenant-standing-owner').find(row => row.id === 'runtime-' + kind);
        const run = store.runSchedule(task.id, { manualRunId: 'refresh-' + kind });
        const context = store.routineExecutionContext(task.id, run.id);
        store.completeScheduleRun(task.id, run.id, { id: 'refresh-reply-' + kind, role: 'assistant', content: 'Refresh recap.' },
          { agentId: context.agent.id, providerId: context.provider.id }, 30_000, bodies[kind]);
        const artifact = store.listArtifacts('tenant-standing-owner').find(row => row.sourceScheduleId === task.id);
        result[kind] = { id: artifact.id, sourceSessionId: artifact.sourceSessionId,
          body: store.artifactContent('tenant-standing-owner')[artifact.id] };
      }
      console.log(JSON.stringify(result));
    `))
    for (const kind of ['sheet', 'slide']) {
      assert.equal(refreshed[kind].id, first[kind].id, `${backend}/${kind}: refresh retains the routine artifact identity`)
      assert.notEqual(refreshed[kind].sourceSessionId, first[kind].sourceSessionId, `${backend}/${kind}: latest run provenance refreshes`)
      assert.equal(refreshed[kind].body.revision, 1)
    }
    assert.deepEqual(refreshed.sheet.body.rows, [['Refreshed']])
    assert.deepEqual(refreshed.slide.body.slides, [{ title: 'Refreshed', bullets: ['Current'] }])
  })

  test(`${backend}: graph specs and queued standing output round-trip for every authored kind`, () => {
    const file = join(ROOT, `roundtrip-${backend}`)
    ok(boot(file, backend, `
      for (const kind of ['doc', 'sheet', 'slide']) {
        const task = store.addSchedule({ ...${seed}, name: 'Typed ' + kind }, 'typed-' + kind);
        store.applyRelationOp({ kind: 'set-schedule-artifact', scheduleId: task.id, scheduleName: task.name, cadence: task.cadence, artifactName: 'report.data', artifactKind: kind }, 'tenant-standing-owner');
        store.runSchedule(task.id, { manualRunId: 'queued-' + kind });
      }
      const legacy = store.addSchedule({ ...${seed}, name: 'Legacy output' }, 'typed-legacy');
      const legacyRun = store.runSchedule(legacy.id, { manualRunId: 'queued-legacy' });
      const state = loadState();
      state.graph.scheduleArtifact[legacy.id] = 'legacy.xlsx';
      const persistedLegacy = state.schedules.find(task => task.id === legacy.id).runs.find(run => run.id === legacyRun.id);
      persistedLegacy.execution.standing = { artifactName: 'legacy.xlsx', tools: [] };
      saveState(state);
    `))
    const result = ok(boot(file, backend, `
      const state = loadState();
      console.log(JSON.stringify({
        graph: state.graph.scheduleArtifact,
        standing: Object.fromEntries(state.schedules.filter(task => task.id.startsWith('typed-')).map(task => [task.id, task.runs[0]?.execution?.standing])),
      }));
    `))
    for (const kind of ['doc', 'sheet', 'slide']) {
      assert.deepEqual(result.graph[`typed-${kind}`], { name: 'report.data', kind })
      assert.deepEqual(result.standing[`typed-${kind}`], { artifact: { name: 'report.data', kind }, tools: [] })
    }
    assert.equal(result.graph['typed-legacy'], 'legacy.xlsx', `${backend}: storage does not guess from the suffix or rewrite legacy bytes`)
    assert.deepEqual(result.standing['typed-legacy'], { artifactName: 'legacy.xlsx', tools: [] })
  })

  test(`${backend}: malformed present graph and queued output specs refuse restart`, () => {
    const mutations = [
      `state.graph.scheduleArtifact[task.id] = { name: 'report', kind: 'spreadsheet' };`,
      `state.graph.scheduleArtifact[task.id] = { name: 'report', kind: 'sheet', extra: true };`,
      `run.execution.standing = { artifact: 'report.xlsx', tools: [] };`,
      `run.execution.standing = { artifact: { name: 'report', kind: 'slides' }, tools: [] };`,
      `run.execution.standing = { artifact: { name: 'report', kind: 'slide' }, artifactName: 'report', tools: [] };`,
    ]
    for (const [index, mutation] of mutations.entries()) {
      const file = join(ROOT, `malformed-${index}-${backend}`)
      ok(boot(file, backend, `
        const task = store.addSchedule({ ...${seed} }, 'malformed-${index}');
        store.applyRelationOp({ kind: 'set-schedule-artifact', scheduleId: task.id, scheduleName: task.name, cadence: task.cadence, artifactName: 'report', artifactKind: 'sheet' }, 'tenant-standing-owner');
        const queued = store.runSchedule(task.id, { manualRunId: 'malformed-run-${index}' });
        const state = loadState();
        const run = state.schedules.find(candidate => candidate.id === task.id).runs.find(candidate => candidate.id === queued.id);
        ${mutation}
        saveState(state);
      `))
      const refused = boot(file, backend)
      assert.notEqual(refused.status, 0, `${backend}/${index}: malformed present state must stop startup`)
      assert.match(refused.stderr, /could not be loaded|Refusing to replace existing data/)
    }
  })
}
