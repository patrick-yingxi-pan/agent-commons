/** Real Dispatch rows are private bound Conversations, not fixture feed entries.
 * Exercise their running→interrupted recovery and retirement through fresh store
 * processes over both durable backends. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { after, test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = mkdtempSync(join(tmpdir(), `agent-commons-real-dispatch-${process.pid}-`))
const storeModule = new URL('../store/index.ts', import.meta.url).href
const persistenceModule = new URL('./persist.ts', import.meta.url).href
const identityModule = new URL('../dispatchIdentity.ts', import.meta.url).href
const TENANT = 'real-dispatch-durability-owner'
const KEY = 'real-dispatch-durability-replay-key'
const TITLE = 'Review the durable migration'
const DETAIL = 'Check the exact database binding and rollback steps.'

after(() => rmSync(ROOT, { recursive: true, force: true }))

function boot(file: string, backend: 'json' | 'sqlite', work: string): Record<string, any> {
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', `
    const { store } = await import(${JSON.stringify(storeModule)});
    const { closePersistence, loadState } = await import(${JSON.stringify(persistenceModule)});
    const { manualDispatchRunId } = await import(${JSON.stringify(identityModule)});
    store.initPersistence();
    const dispatchId = manualDispatchRunId(${JSON.stringify(TENANT)}, ${JSON.stringify(KEY)});
    ${work}
    closePersistence();
  `], {
    encoding: 'utf8',
    timeout: 30_000,
    env: {
      ...process.env,
      INITIAL_WORLD: 'clean', DEPLOYMENT_PROFILE: '', BACKEND: 'mock', MODEL_INLINE: '1',
      PERSIST_BACKEND: backend, DATA_FILE: file, DATABASE_PATH: file,
    },
  })
  assert.equal(result.status, 0, `fresh ${backend} process failed:\n${result.stderr}`)
  return JSON.parse(result.stdout)
}

for (const backend of ['json', 'sqlite'] as const) {
  test(`${backend}: real Dispatch recovers interrupted with frozen binding and replays without reminting`, () => {
    const file = join(ROOT, `dispatch-${backend}`)
    const first = boot(file, backend, `
      const agent = store.listAgents(${JSON.stringify(TENANT)}).find(row => row.id === 'agent-default');
      if (!agent) throw new Error('The clean world must provide its default Agent.');
      const provider = store.listProviders(${JSON.stringify(TENANT)}).find(row => row.id === agent.providerId);
      const modelId = provider?.models?.[0]?.id;
      if (!modelId) throw new Error('The default provider must have a selectable model.');
      const execution = { agentId: agent.id, providerId: provider.id, modelId };
      const input = { title: ${JSON.stringify(TITLE)}, detail: ${JSON.stringify(DETAIL)}, execution };
      const run = store.startRealDispatch(input, ${JSON.stringify(TENANT)}, dispatchId);
      const session = store.getSession(run.execution.sessionId);
      if (!session) throw new Error('The real Dispatch must commit its private Session.');
      console.log(JSON.stringify({ dispatchId, execution, run, session,
        hasUsageMeters: loadState().usageMeters !== undefined }));
    `)

    assert.equal(first.run.status, 'running')
    assert.equal(first.hasUsageMeters, true, 'this is a current snapshot, not legacy usage-baseline recovery')
    assert.equal(first.run.detail, DETAIL)
    assert.deepEqual(
      [first.run.execution.agentId, first.run.execution.providerId, first.run.execution.modelId],
      [first.execution.agentId, first.execution.providerId, first.execution.modelId],
    )
    assert.equal(first.session.id, first.run.execution.sessionId)
    assert.equal(first.session.tenantId, TENANT)

    const recovered = boot(file, backend, `
      // Read the backing store before Retry or deletion can accidentally persist
      // an in-memory-only recovery. Current snapshots already have usageMeters.
      const durableRun = loadState().dispatch.find(row => row.id === dispatchId);
      const beforeRuns = store.listDispatch(${JSON.stringify(TENANT)}).filter(row => row.id === dispatchId);
      const run = store.getRealDispatch(dispatchId, ${JSON.stringify(TENANT)});
      const session = run && run !== 'retired' ? store.getSession(run.execution.sessionId) : undefined;
      const retry = store.startRealDispatch({
        title: 'Changed retry title', detail: 'Changed retry detail.', execution: ${JSON.stringify(first.execution)},
      }, ${JSON.stringify(TENANT)}, dispatchId);
      const afterRuns = store.listDispatch(${JSON.stringify(TENANT)}).filter(row => row.id === dispatchId);
      const afterSessions = store.listSessions(${JSON.stringify(TENANT)}).filter(row => row.id === ${JSON.stringify(first.session.id)});
      const removed = store.removeSession(${JSON.stringify(first.session.id)});
      const afterDelete = store.getRealDispatch(dispatchId, ${JSON.stringify(TENANT)});
      let retiredReplayRefused = false;
      try { store.startRealDispatch({ title: 'No resurrection', execution: ${JSON.stringify(first.execution)} }, ${JSON.stringify(TENANT)}, dispatchId); }
      catch (error) { retiredReplayRefused = error.name === 'NotFoundError'; }
      console.log(JSON.stringify({ durableRun, run, session, retry, beforeRuns, afterRuns, afterSessions, removed,
        afterDelete, retiredReplayRefused, remainingRuns: store.listDispatch(${JSON.stringify(TENANT)}).filter(row => row.id === dispatchId),
        remainingSession: store.getSession(${JSON.stringify(first.session.id)}) }));
    `)

    assert.equal(recovered.run.status, 'failed')
    assert.equal(recovered.run.execution.state, 'interrupted', 'restart records durable interruption, not fixture failure prose')
    assert.deepEqual(recovered.durableRun, recovered.run,
      'startup commits the interrupted receipt before admission, without relying on a later mutation')
    assert.equal(recovered.run.detail, DETAIL, 'the private Dispatch detail survives process restart')
    assert.deepEqual(
      [recovered.run.execution.agentId, recovered.run.execution.providerId, recovered.run.execution.modelId],
      [first.execution.agentId, first.execution.providerId, first.execution.modelId],
      'the exact selected Agent/provider/model binding survives restart',
    )
    assert.equal(recovered.session.id, first.session.id)
    assert.equal(recovered.session.agentId, first.execution.agentId)
    assert.equal(recovered.session.providerId, first.execution.providerId)
    assert.equal(recovered.session.modelId, first.execution.modelId)
    assert.deepEqual(recovered.session.messages, first.session.messages)
    assert.deepEqual(recovered.retry, recovered.run, 'same-key retry returns current interrupted truth before changed form input')
    assert.equal(recovered.beforeRuns.length, 1)
    assert.equal(recovered.afterRuns.length, 1, 'replay does not create another feed row')
    assert.equal(recovered.afterSessions.length, 1, 'replay does not create another private Session')
    assert.equal(recovered.removed, true)
    assert.equal(recovered.afterDelete, 'retired')
    assert.equal(recovered.retiredReplayRefused, true, 'a deleted Dispatch identity cannot be reminted')
    assert.deepEqual(recovered.remainingRuns, [])
    assert.equal(recovered.remainingSession, undefined)

    const afterAnotherRestart = boot(file, backend, `
      const row = store.getRealDispatch(dispatchId, ${JSON.stringify(TENANT)});
      let refused = false;
      try { store.startRealDispatch({ title: 'Still retired', execution: ${JSON.stringify(first.execution)} }, ${JSON.stringify(TENANT)}, dispatchId); }
      catch (error) { refused = error.name === 'NotFoundError'; }
      console.log(JSON.stringify({ row, refused,
        runs: store.listDispatch(${JSON.stringify(TENANT)}).filter(candidate => candidate.id === dispatchId),
        session: store.getSession(${JSON.stringify(first.session.id)}) }));
    `)
    assert.equal(afterAnotherRestart.row, 'retired', 'the retirement proof survives a second restart')
    assert.equal(afterAnotherRestart.refused, true)
    assert.deepEqual(afterAnotherRestart.runs, [])
    assert.equal(afterAnotherRestart.session, undefined)
  })
}
