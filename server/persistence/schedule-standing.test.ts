/** A queued routine owns the standing authority that existed when it was
 * enqueued. This suite crosses the real JSON/SQLite restart boundary: later
 * relation edits must neither widen an old run nor redirect its output. */
import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { docBlockId } from '../documentIdentity.ts'

const ROOT = mkdtempSync(join(tmpdir(), `agent-commons-schedule-standing-${process.pid}-`))
const storeModule = new URL('../store/index.ts', import.meta.url).href
const persistenceModule = new URL('./persist.ts', import.meta.url).href
const formatModule = new URL('./format.ts', import.meta.url).href
const runnerModule = new URL('../routineRunner.ts', import.meta.url).href

after(() => rmSync(ROOT, { recursive: true, force: true }))

function boot(file: string, backend: 'json' | 'sqlite', work: string) {
  const script = `
    const { store } = await import(${JSON.stringify(storeModule)});
    const { loadState, saveState, closePersistence } = await import(${JSON.stringify(persistenceModule)});
    const { hasCorePersistedShape } = await import(${JSON.stringify(formatModule)});
    const { createRoutineRunner } = await import(${JSON.stringify(runnerModule)});
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
  name: 'Frozen standing routine',
  cadence: 'Daily · 9:00 AM',
  next: 'tomorrow',
  enabled: false,
  lastStatus: 'pending',
  subtitle: 'Tests queued standing authority.',
  trigger: 'Run the report.',
  prompt: 'Write the report.',
  steps: [],
  delivery: { tool: { id: 'claude', label: 'Claude', tone: 'claude' }, target: 'Run conversation' },
  runs: [],
  model: 'Claude Opus 4.8',
}`

const fakeSuccess = `async () => ({
  outcome: 'ok',
  usage: { inputTokens: 1, outputTokens: 1 },
  message: { id: 'model-unexpected', role: 'assistant', content: 'Must not replace the prior report.' },
})`

const waitForTerminal = `async (taskId, runId) => {
  for (let index = 0; index < 100; index += 1) {
    const run = store.listSchedules('tenant-standing-owner').find(task => task.id === taskId)?.runs.find(candidate => candidate.id === runId);
    if (run && run.status !== 'running') return run;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('routine did not settle');
}`

for (const backend of ['json', 'sqlite'] as const) {
  test(`${backend}: restart retains the queued artifact/tool snapshot and rejects a changed live binding`, () => {
    const file = join(ROOT, `changed-binding-${backend}`)
    const first = ok(boot(file, backend, `
      const task = store.addSchedule({ ...${taskSeed}, tenantId: 'tenant-standing-owner' }, 'standing-changed');
      const tool = { id: 'slack', label: 'Slack', tone: 'connector' };
      store.applyRelationOp({ kind: 'set-schedule-artifact', scheduleId: task.id, scheduleName: task.name, cadence: task.cadence, artifactName: 'prior.md' }, 'tenant-standing-owner');
      store.applyRelationOp({ kind: 'schedule-add-tool', scheduleId: task.id, scheduleName: task.name, cadence: task.cadence, tool }, 'tenant-standing-owner');
      const prior = store.runSchedule(task.id, { manualRunId: 'prior-run' });
      const priorContext = store.routineExecutionContext(task.id, prior.id);
      store.completeScheduleRun(task.id, prior.id, { id: 'prior-model', role: 'assistant', content: 'Keep this prior report.' }, { agentId: priorContext.agent.id, providerId: priorContext.provider.id });
      const queued = store.runSchedule(task.id, { manualRunId: 'queued-before-change' });
      store.applyRelationOp({ kind: 'set-schedule-artifact', scheduleId: task.id, scheduleName: task.name, cadence: task.cadence, artifactName: 'later.md' }, 'tenant-standing-owner');
      const state = loadState();
      const persisted = state.schedules.find(candidate => candidate.id === task.id).runs.find(run => run.id === queued.id).execution.standing;
      console.log(JSON.stringify({ taskId: task.id, runId: queued.id, persisted }));
    `))
    assert.deepEqual(first.persisted, {
      artifact: { name: 'prior.md', kind: 'doc' },
      tools: [{ id: 'slack', label: 'Slack', tone: 'connector' }],
    }, `${backend}: the queued authority is detached and durable`)

    const second = ok(boot(file, backend, `
      let calls = 0;
      const runner = createRoutineRunner(store, async (...args) => { calls += 1; return (${fakeSuccess})(...args); }, { retryBaseMs: 1 });
      runner.start();
      const run = await (${waitForTerminal})('standing-changed', 'queued-before-change');
      runner.stop();
      const artifacts = store.listArtifacts('tenant-standing-owner').filter(artifact => artifact.sourceScheduleId === 'standing-changed');
      const prior = artifacts.find(artifact => artifact.name === 'prior.md');
      const priorBody = prior && store.artifactContent('tenant-standing-owner')[prior.id];
      console.log(JSON.stringify({ calls, run, artifacts, priorBody, persisted: loadState().schedules.find(task => task.id === 'standing-changed').runs.find(candidate => candidate.id === 'queued-before-change').execution.standing }));
    `))
    assert.equal(second.calls, 0, `${backend}: changed authority is rejected before model execution`)
    assert.equal(second.run.status, 'failed')
    assert.equal(second.run.failureCode, 'authority_denied')
    assert.equal(second.artifacts.length, 1, `${backend}: no replacement artifact is published`)
    assert.deepEqual(second.priorBody?.blocks, [{ id: docBlockId(second.artifacts[0].id, 0, 0), p: 'Keep this prior report.' }])
    assert.equal(second.artifacts[0]?.name, 'prior.md')
    assert.deepEqual(second.persisted, first.persisted, `${backend}: settlement retains the original audit snapshot`)
  })

  test(`${backend}: revoking or altering any frozen extra-tool field fails closed after restart`, () => {
    for (const [variant, rewrite] of [
      ['removed', '[]'],
      ['id', `[{ id: 'slack-v2', label: 'Slack', tone: 'connector' }]`],
      ['label', `[{ id: 'slack', label: 'Slack renamed', tone: 'connector' }]`],
      ['tone', `[{ id: 'slack', label: 'Slack', tone: 'mcp' }]`],
      ['needsAuth', `[{ id: 'slack', label: 'Slack', tone: 'connector', needsAuth: true }]`],
    ] as const) {
      const file = join(ROOT, `changed-tool-${variant}-${backend}`)
      ok(boot(file, backend, `
        const task = store.addSchedule({ ...${taskSeed}, tenantId: 'tenant-standing-owner' }, 'standing-tool-${variant}');
        const tool = { id: 'slack', label: 'Slack', tone: 'connector' };
        store.applyRelationOp({ kind: 'schedule-add-tool', scheduleId: task.id, scheduleName: task.name, cadence: task.cadence, tool }, 'tenant-standing-owner');
        const queued = store.runSchedule(task.id, { manualRunId: 'queued-tool-${variant}' });
        const state = loadState();
        state.graph.scheduleExtraTools[task.id] = ${rewrite};
        saveState(state);
      `))
      const result = ok(boot(file, backend, `
        let calls = 0;
        const runner = createRoutineRunner(store, async (...args) => { calls += 1; return (${fakeSuccess})(...args); }, { retryBaseMs: 1 });
        runner.start();
        const run = await (${waitForTerminal})('standing-tool-${variant}', 'queued-tool-${variant}');
        runner.stop();
        console.log(JSON.stringify({ calls, run }));
      `))
      assert.equal(result.calls, 0, `${backend}/${variant}: exact tool mismatch is rejected before the model`)
      assert.equal(result.run.status, 'failed')
      assert.equal(result.run.failureCode, 'authority_denied')
    }
  })

  test(`${backend}: frozen-none and legacy runs never adopt standing grants added after enqueue`, () => {
    for (const legacy of [false, true]) {
      const suffix = legacy ? 'legacy' : 'frozen-none'
      const file = join(ROOT, `late-standing-${suffix}-${backend}`)
      const prepared = ok(boot(file, backend, `
        const task = store.addSchedule({ ...${taskSeed}, tenantId: 'tenant-standing-owner' }, 'late-${suffix}');
        const queued = store.runSchedule(task.id, { manualRunId: 'queued-${suffix}' });
        store.applyRelationOp({ kind: 'set-schedule-artifact', scheduleId: task.id, scheduleName: task.name, cadence: task.cadence, artifactName: 'late.md' }, 'tenant-standing-owner');
        store.applyRelationOp({ kind: 'schedule-add-tool', scheduleId: task.id, scheduleName: task.name, cadence: task.cadence, tool: { id: 'slack', label: 'Slack', tone: 'connector' } }, 'tenant-standing-owner');
        const state = loadState();
        const run = state.schedules.find(candidate => candidate.id === task.id).runs.find(candidate => candidate.id === queued.id);
        ${legacy ? 'delete run.execution.standing;' : ''}
        saveState(state);
        console.log(JSON.stringify({ standing: run.execution.standing ?? 'absent' }));
      `))
      assert.deepEqual(prepared.standing, legacy ? 'absent' : { artifact: null, tools: [] })
      const result = ok(boot(file, backend, `
        let calls = 0;
        const runner = createRoutineRunner(store, async (...args) => { calls += 1; return (${fakeSuccess})(...args); }, { retryBaseMs: 1 });
        runner.start();
        const run = await (${waitForTerminal})('late-${suffix}', 'queued-${suffix}');
        runner.stop();
        console.log(JSON.stringify({ calls, run, artifacts: store.listArtifacts('tenant-standing-owner').filter(artifact => artifact.sourceScheduleId === 'late-${suffix}') }));
      `))
      assert.equal(result.calls, legacy ? 0 : 1, `${backend}/${suffix}: late authority is not inferred`)
      assert.equal(result.run.status, legacy ? 'failed' : 'ok')
      assert.equal(result.run.failureCode, legacy ? 'authority_denied' : undefined)
      assert.deepEqual(result.artifacts, [])
    }
  })

  test(`${backend}: a legacy run with no live standing grant remains executable`, () => {
    const file = join(ROOT, `legacy-no-standing-${backend}`)
    ok(boot(file, backend, `
      const task = store.addSchedule({ ...${taskSeed}, tenantId: 'tenant-standing-owner' }, 'legacy-no-standing');
      const queued = store.runSchedule(task.id, { manualRunId: 'legacy-no-standing-run' });
      const state = loadState();
      delete state.schedules.find(candidate => candidate.id === task.id).runs.find(candidate => candidate.id === queued.id).execution.standing;
      saveState(state);
    `))
    const result = ok(boot(file, backend, `
      let calls = 0;
      const runner = createRoutineRunner(store, async () => { calls += 1; return { outcome: 'ok', usage: { inputTokens: 1, outputTokens: 1 }, message: { id: 'legacy-model', role: 'assistant', content: 'Ordinary legacy result.' } }; }, { retryBaseMs: 1 });
      runner.start();
      const run = await (${waitForTerminal})('legacy-no-standing', 'legacy-no-standing-run');
      runner.stop();
      console.log(JSON.stringify({ calls, run, artifacts: store.listArtifacts('tenant-standing-owner').filter(artifact => artifact.sourceScheduleId === 'legacy-no-standing') }));
    `))
    assert.equal(result.calls, 1)
    assert.equal(result.run.status, 'ok')
    assert.deepEqual(result.artifacts, [], `${backend}: absence is compatible, not inferred authority`)
  })

  test(`${backend}: deleting a routine retires standing authority before same-id recreation`, () => {
    const file = join(ROOT, `deleted-standing-${backend}`)
    const removed = ok(boot(file, backend, `
      const task = store.addSchedule({ ...${taskSeed}, tenantId: 'tenant-standing-owner' }, 'recreated-standing-id');
      const tool = { id: 'slack', label: 'Slack', tone: 'connector' };
      store.applyRelationOp({ kind: 'set-schedule-artifact', scheduleId: task.id, scheduleName: task.name, cadence: task.cadence, artifactName: 'retained.md' }, 'tenant-standing-owner');
      store.applyRelationOp({ kind: 'set-schedule-session', scheduleId: task.id, scheduleName: task.name, cadence: task.cadence, sessionLabel: 'Retired session' }, 'tenant-standing-owner');
      store.applyRelationOp({ kind: 'schedule-add-tool', scheduleId: task.id, scheduleName: task.name, cadence: task.cadence, tool }, 'tenant-standing-owner');
      const run = store.runSchedule(task.id, { manualRunId: 'retained-document-run' });
      const context = store.routineExecutionContext(task.id, run.id);
      store.completeScheduleRun(task.id, run.id, { id: 'retained-model', role: 'assistant', content: 'The retained original body.' }, { agentId: context.agent.id, providerId: context.provider.id });
      const artifact = store.listArtifacts('tenant-standing-owner').find(candidate => candidate.sourceScheduleId === task.id);
      const grant = store.createGrant({ subject: { kind: 'artifact', id: artifact.id }, audience: { kind: 'link', token: '' }, tier: 'view' }, 'tenant-standing-owner');
      if (typeof grant !== 'object' || grant.audience.kind !== 'link' || !grant.id) throw new Error('artifact grant was not created');
      if (!store.redeemGrant(grant.audience.token, 'tenant-standing-reader')) throw new Error('artifact grant was not redeemed');
      const before = { artifact: structuredClone(artifact), body: structuredClone(store.artifactContent('tenant-standing-owner')[artifact.id]), grants: structuredClone(store.listGrants({ kind: 'artifact', id: artifact.id }, 'tenant-standing-owner')) };
      const observed = [];
      const unsubscribe = store.subscribe(event => {
        if (event.type !== 'schedule.changed' && event.type !== 'artifact.changed') return;
        const state = loadState();
        const persistedArtifact = state.graph.extraArtifacts.find(candidate => candidate.id === artifact.id);
        observed.push({
          type: event.type,
          readerVisible: event.type === 'artifact.changed' ? store.eventVisibleToTenant(event, 'tenant-standing-reader') : undefined,
          foreignVisible: event.type === 'artifact.changed' ? store.eventVisibleToTenant(event, 'tenant-standing-foreign') : undefined,
          committed: !state.schedules.some(candidate => candidate.id === task.id) &&
            !Object.hasOwn(state.graph.scheduleArtifact, task.id) &&
            !Object.hasOwn(state.graph.scheduleSession, task.id) &&
            !Object.hasOwn(state.graph.scheduleExtraTools, task.id) &&
            !Object.keys(state.graph.standingApprovals).some(key => key.includes(task.id)) &&
            persistedArtifact?.sourceScheduleId === undefined,
        });
      });
      const didRemove = store.removeSchedule(task.id);
      unsubscribe();
      const state = loadState();
      const retained = state.graph.extraArtifacts.find(candidate => candidate.id === artifact.id);
      const retainedBody = state.artifactBodies.find(([id]) => id === artifact.id)?.[1];
      const retainedGrants = store.listGrants({ kind: 'artifact', id: artifact.id }, 'tenant-standing-owner');
      console.log(JSON.stringify({ didRemove, before, observed, retained, retainedBody, retainedGrants, graph: state.graph }));
    `))
    assert.equal(removed.didRemove, true)
    assert.equal(removed.before.grants.length, 1, `${backend}: the retention fixture has one real grant`)
    assert.deepEqual(removed.observed.map((entry: any) => entry.type).sort(), ['artifact.changed', 'schedule.changed'])
    assert.ok(removed.observed.every((entry: any) => entry.committed), `${backend}: observers load the committed cleanup, not stale authority`)
    const artifactEvent = removed.observed.find((entry: any) => entry.type === 'artifact.changed')
    assert.equal(artifactEvent?.readerVisible, true, `${backend}: the retained artifact invalidation reaches a valid granted reader`)
    assert.equal(artifactEvent?.foreignVisible, false, `${backend}: the retained artifact invalidation stays off an unrelated tenant`)
    assert.equal(removed.graph.scheduleArtifact['recreated-standing-id'], undefined)
    assert.equal(removed.graph.scheduleSession['recreated-standing-id'], undefined)
    assert.equal(removed.graph.scheduleExtraTools['recreated-standing-id'], undefined)
    assert.equal(Object.keys(removed.graph.standingApprovals).some((key) => key.includes('recreated-standing-id')), false)
    assert.equal(removed.retained.id, removed.before.artifact.id)
    assert.equal(removed.retained.sourceScheduleId, undefined, 'deletion retires the write-authority join')
    assert.equal(removed.retained.source, removed.before.artifact.source)
    assert.equal(removed.retained.sourceSessionId, removed.before.artifact.sourceSessionId)
    assert.equal(removed.retained.name, removed.before.artifact.name)
    assert.deepEqual(removed.retainedBody, removed.before.body)
    assert.deepEqual(removed.retainedGrants, removed.before.grants)

    const recreated = ok(boot(file, backend, `
      const original = store.listArtifacts('tenant-standing-owner').find(candidate => candidate.id === ${JSON.stringify(removed.retained.id)});
      const originalBody = structuredClone(store.artifactContent('tenant-standing-owner')[original.id]);
      const originalGrants = structuredClone(store.listGrants({ kind: 'artifact', id: original.id }, 'tenant-standing-owner'));
      const task = store.addSchedule({ ...${taskSeed}, tenantId: 'tenant-standing-owner' }, 'recreated-standing-id');
      const unapproved = store.runSchedule(task.id, { manualRunId: 'recreated-without-standing' });
      const unapprovedContext = store.routineExecutionContext(task.id, unapproved.id);
      const frozen = structuredClone(unapproved.execution.standing);
      const contexts = unapprovedContext.contexts.map(context => context.id);
      store.completeScheduleRun(task.id, unapproved.id, { id: 'unapproved-model', role: 'assistant', content: 'Must remain only in the run.' }, { agentId: unapprovedContext.agent.id, providerId: unapprovedContext.provider.id });
      const afterUnapproved = store.listArtifacts('tenant-standing-owner').filter(candidate => candidate.name === 'retained.md');
      store.applyRelationOp({ kind: 'set-schedule-artifact', scheduleId: task.id, scheduleName: task.name, cadence: task.cadence, artifactName: 'retained.md' }, 'tenant-standing-owner');
      const approved = store.runSchedule(task.id, { manualRunId: 'recreated-new-standing' });
      const approvedContext = store.routineExecutionContext(task.id, approved.id);
      store.completeScheduleRun(task.id, approved.id, { id: 'approved-model', role: 'assistant', content: 'A distinct newly approved body.' }, { agentId: approvedContext.agent.id, providerId: approvedContext.provider.id });
      const artifacts = store.listArtifacts('tenant-standing-owner').filter(candidate => candidate.name === 'retained.md');
      const replacement = artifacts.find(candidate => candidate.sourceScheduleId === task.id);
      console.log(JSON.stringify({
        original, originalBody, originalGrants, frozen, contexts,
        afterUnapproved: afterUnapproved.map(candidate => ({ id: candidate.id, sourceScheduleId: candidate.sourceScheduleId })),
        artifacts,
        replacementBody: replacement && store.artifactContent('tenant-standing-owner')[replacement.id],
        originalAfter: store.listArtifacts('tenant-standing-owner').find(candidate => candidate.id === original.id),
        originalBodyAfter: store.artifactContent('tenant-standing-owner')[original.id],
        originalGrantsAfter: store.listGrants({ kind: 'artifact', id: original.id }, 'tenant-standing-owner'),
      }));
    `))
    assert.deepEqual(recreated.frozen, { artifact: null, tools: [] })
    assert.deepEqual(recreated.contexts, [], `${backend}: recreated runs inherit no retired tool context`)
    assert.deepEqual(recreated.afterUnapproved, [{ id: removed.retained.id }], `${backend}: no retired output authority is inferred`)
    assert.equal(recreated.artifacts.length, 2)
    const replacement = recreated.artifacts.find((artifact: any) => artifact.sourceScheduleId === 'recreated-standing-id')
    assert.ok(replacement)
    assert.notEqual(replacement.id, removed.retained.id, `${backend}: new approval cannot recapture the retained artifact`)
    assert.deepEqual(recreated.replacementBody?.blocks, [{
      id: docBlockId(replacement.id, recreated.replacementBody?.revision ?? 0, 0), p: 'A distinct newly approved body.',
    }])
    assert.equal(recreated.originalAfter.sourceScheduleId, undefined)
    assert.deepEqual(recreated.originalBodyAfter, recreated.originalBody)
    assert.deepEqual(recreated.originalGrantsAfter, recreated.originalGrants)
  })

  test(`${backend}: rehydrate retires legacy orphan authority before same-id recreation`, () => {
    const file = join(ROOT, `legacy-orphan-standing-${backend}`)
    const prepared = ok(boot(file, backend, `
      const victim = store.addSchedule({ ...${taskSeed}, tenantId: 'tenant-standing-owner' }, 'legacy-orphan-id');
      const survivor = store.addSchedule({ ...${taskSeed}, name: 'Unrelated live routine', tenantId: 'tenant-standing-owner' }, 'live-standing-id');
      const tool = { id: 'slack', label: 'Slack', tone: 'connector' };
      for (const [task, name, sessionLabel] of [[victim, 'legacy-retained.md', 'Legacy session'], [survivor, 'live-retained.md', 'Live session']]) {
        store.applyRelationOp({ kind: 'set-schedule-artifact', scheduleId: task.id, scheduleName: task.name, cadence: task.cadence, artifactName: name }, 'tenant-standing-owner');
        store.applyRelationOp({ kind: 'set-schedule-session', scheduleId: task.id, scheduleName: task.name, cadence: task.cadence, sessionLabel }, 'tenant-standing-owner');
        store.applyRelationOp({ kind: 'schedule-add-tool', scheduleId: task.id, scheduleName: task.name, cadence: task.cadence, tool }, 'tenant-standing-owner');
        const run = store.runSchedule(task.id, { manualRunId: task.id + '-document-run' });
        const context = store.routineExecutionContext(task.id, run.id);
        store.completeScheduleRun(task.id, run.id, { id: task.id + '-model', role: 'assistant', content: task.id === victim.id ? 'Legacy retained body.' : 'Live retained body.' }, { agentId: context.agent.id, providerId: context.provider.id });
      }
      const artifact = store.listArtifacts('tenant-standing-owner').find(candidate => candidate.sourceScheduleId === victim.id);
      const grant = store.createGrant({ subject: { kind: 'artifact', id: artifact.id }, audience: { kind: 'link', token: '' }, tier: 'view' }, 'tenant-standing-owner');
      if (typeof grant !== 'object' || grant.audience.kind !== 'link' || !grant.id) throw new Error('legacy artifact grant was not created');
      if (!store.redeemGrant(grant.audience.token, 'tenant-standing-reader')) throw new Error('legacy artifact grant was not redeemed');
      const state = loadState();
      const victimRunSessions = new Set(state.schedules.find(candidate => candidate.id === victim.id).runs.map(run => 'srun-' + victim.id + '-' + run.id));
      const beforeRevision = state.graph.revision ?? 0;
      state.schedules = state.schedules.filter(candidate => candidate.id !== victim.id);
      state.sessions = state.sessions.filter(session => !victimRunSessions.has(session.id));
      // Deliberately leave every graph map, standing key, and sourceScheduleId
      // exactly as an older non-cascading removeSchedule snapshot wrote them.
      saveState(state);
      console.log(JSON.stringify({ victimArtifactId: artifact.id, beforeRevision }));
    `))

    const cleaned = ok(boot(file, backend, `
      const state = loadState();
      const victimArtifact = state.graph.extraArtifacts.find(candidate => candidate.id === ${JSON.stringify(prepared.victimArtifactId)});
      const survivorArtifact = state.graph.extraArtifacts.find(candidate => candidate.sourceScheduleId === 'live-standing-id');
      console.log(JSON.stringify({
        graph: state.graph,
        revision: state.graph.revision,
        victimArtifact,
        victimBody: state.artifactBodies.find(([id]) => id === victimArtifact.id)?.[1],
        victimGrants: store.listGrants({ kind: 'artifact', id: victimArtifact.id }, 'tenant-standing-owner'),
        survivorArtifact,
      }));
    `))
    assert.equal(cleaned.revision, prepared.beforeRevision + 1, `${backend}: one recovery batch advances the graph once`)
    assert.equal(cleaned.graph.scheduleArtifact['legacy-orphan-id'], undefined)
    assert.equal(cleaned.graph.scheduleSession['legacy-orphan-id'], undefined)
    assert.equal(cleaned.graph.scheduleExtraTools['legacy-orphan-id'], undefined)
    assert.equal(Object.keys(cleaned.graph.standingApprovals).some((key) => key.includes('legacy-orphan-id')), false)
    assert.equal(cleaned.victimArtifact.sourceScheduleId, undefined)
    assert.deepEqual(cleaned.victimBody?.blocks, [{
      id: docBlockId(cleaned.victimArtifact.id, cleaned.victimBody?.revision ?? 0, 0), p: 'Legacy retained body.',
    }])
    assert.equal(cleaned.victimGrants.length, 1)
    assert.deepEqual(cleaned.graph.scheduleArtifact['live-standing-id'], { name: 'live-retained.md', kind: 'doc' })
    assert.equal(cleaned.graph.scheduleSession['live-standing-id'], 'Live session')
    assert.deepEqual(cleaned.graph.scheduleExtraTools['live-standing-id'], [{ id: 'slack', label: 'Slack', tone: 'connector' }])
    assert.ok(Object.keys(cleaned.graph.standingApprovals).some((key) => key.includes('live-standing-id')))
    assert.equal(cleaned.survivorArtifact.sourceScheduleId, 'live-standing-id')

    const recreated = ok(boot(file, backend, `
      const before = loadState();
      const oldArtifact = store.listArtifacts('tenant-standing-owner').find(candidate => candidate.id === ${JSON.stringify(prepared.victimArtifactId)});
      const oldBody = structuredClone(store.artifactContent('tenant-standing-owner')[oldArtifact.id]);
      const oldGrants = structuredClone(store.listGrants({ kind: 'artifact', id: oldArtifact.id }, 'tenant-standing-owner'));
      const task = store.addSchedule({ ...${taskSeed}, tenantId: 'tenant-standing-owner' }, 'legacy-orphan-id');
      const unapproved = store.runSchedule(task.id, { manualRunId: 'legacy-recreated-unapproved' });
      const unapprovedContext = store.routineExecutionContext(task.id, unapproved.id);
      const frozen = structuredClone(unapproved.execution.standing);
      store.completeScheduleRun(task.id, unapproved.id, { id: 'legacy-unapproved-model', role: 'assistant', content: 'Run-only result.' }, { agentId: unapprovedContext.agent.id, providerId: unapprovedContext.provider.id });
      const afterUnapproved = store.listArtifacts('tenant-standing-owner').filter(candidate => candidate.name === 'legacy-retained.md');
      store.applyRelationOp({ kind: 'set-schedule-artifact', scheduleId: task.id, scheduleName: task.name, cadence: task.cadence, artifactName: 'legacy-retained.md' }, 'tenant-standing-owner');
      const approved = store.runSchedule(task.id, { manualRunId: 'legacy-recreated-approved' });
      const approvedContext = store.routineExecutionContext(task.id, approved.id);
      store.completeScheduleRun(task.id, approved.id, { id: 'legacy-approved-model', role: 'assistant', content: 'New same-id routine body.' }, { agentId: approvedContext.agent.id, providerId: approvedContext.provider.id });
      const artifacts = store.listArtifacts('tenant-standing-owner').filter(candidate => candidate.name === 'legacy-retained.md');
      const created = artifacts.find(candidate => candidate.sourceScheduleId === task.id);
      console.log(JSON.stringify({
        revisionBeforeRecreate: before.graph.revision,
        frozen,
        contexts: unapprovedContext.contexts.map(context => context.id),
        afterUnapproved: afterUnapproved.map(candidate => ({ id: candidate.id, sourceScheduleId: candidate.sourceScheduleId })),
        artifacts,
        createdBody: created && store.artifactContent('tenant-standing-owner')[created.id],
        oldAfter: store.listArtifacts('tenant-standing-owner').find(candidate => candidate.id === oldArtifact.id),
        oldBodyAfter: store.artifactContent('tenant-standing-owner')[oldArtifact.id],
        oldGrantsAfter: store.listGrants({ kind: 'artifact', id: oldArtifact.id }, 'tenant-standing-owner'),
        oldBody,
        oldGrants,
      }));
    `))
    assert.equal(recreated.revisionBeforeRecreate, cleaned.revision, `${backend}: cleanup survived another restart before recreation`)
    assert.deepEqual(recreated.frozen, { artifact: null, tools: [] })
    assert.deepEqual(recreated.contexts, [])
    assert.deepEqual(recreated.afterUnapproved, [{ id: prepared.victimArtifactId }])
    assert.equal(recreated.artifacts.length, 2)
    const created = recreated.artifacts.find((artifact: any) => artifact.sourceScheduleId === 'legacy-orphan-id')
    assert.ok(created)
    assert.notEqual(created.id, prepared.victimArtifactId)
    assert.deepEqual(recreated.createdBody?.blocks, [{ id: docBlockId(created.id, 0, 0), p: 'New same-id routine body.' }])
    assert.equal(recreated.oldAfter.sourceScheduleId, undefined)
    assert.deepEqual(recreated.oldBodyAfter, recreated.oldBody)
    assert.deepEqual(recreated.oldGrantsAfter, recreated.oldGrants)
  })
}

test('a malformed present standing snapshot fails core-state admission', () => {
  const file = join(ROOT, 'malformed-standing.json')
  const result = ok(boot(file, 'json', `
    const task = store.addSchedule({ ...${taskSeed}, tenantId: 'tenant-standing-owner' }, 'malformed-standing');
    const queued = store.runSchedule(task.id, { manualRunId: 'malformed-standing-run' });
    const state = loadState();
    const execution = state.schedules.find(candidate => candidate.id === task.id).runs.find(candidate => candidate.id === queued.id).execution;
    const candidates = [
      null,
      {},
      { artifactName: 42, tools: [] },
      { artifact: { name: 'report', kind: 'spreadsheet' }, tools: [] },
      { artifact: { name: 'report', kind: 'sheet', extra: true }, tools: [] },
      { artifactName: { name: 'report', kind: 'sheet' }, tools: [] },
      { artifact: null, artifactName: null, tools: [] },
      { artifactName: null, tools: 'slack' },
      { artifactName: null, tools: [{ id: 'slack', label: 'Slack', tone: 'connector', unexpected: true }] },
    ];
    const admitted = candidates.map(standing => hasCorePersistedShape({ ...state, schedules: state.schedules.map(candidate => candidate.id !== task.id ? candidate : { ...candidate, runs: candidate.runs.map(run => run.id !== queued.id ? run : { ...run, execution: { ...execution, standing } }) }) }));
    const absent = { ...execution };
    delete absent.standing;
    console.log(JSON.stringify({ admitted, legacyAbsent: hasCorePersistedShape({ ...state, schedules: state.schedules.map(candidate => candidate.id !== task.id ? candidate : { ...candidate, runs: candidate.runs.map(run => run.id !== queued.id ? run : { ...run, execution: absent }) }) }) }));
  `))
  assert.deepEqual(result.admitted, [false, false, false, false, false, false, false, false, false])
  assert.equal(result.legacyAbsent, true, 'absence alone retains legacy compatibility')
})
