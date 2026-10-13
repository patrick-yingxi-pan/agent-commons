import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

const root = mkdtempSync(join(tmpdir(), 'agent-commons-schedule-stop-'))
const storeModule = new URL('../store/index.ts', import.meta.url).href
const persistModule = new URL('./persist.ts', import.meta.url).href
const seedModule = new URL('../data/cowork.ts', import.meta.url).href

after(() => rmSync(root, { recursive: true, force: true }))

function child(script: string, file: string, backend: 'json' | 'sqlite', extraEnv: Record<string, string> = {}) {
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, INITIAL_WORLD: 'clean', DEPLOYMENT_PROFILE: '', BACKEND: 'mock',
      PERSIST_BACKEND: backend, DATA_FILE: file, DATABASE_PATH: file, ...extraEnv },
  })) as any
}

const createAndStop = `
  const { store, configureScheduleExecutor } = await import(${JSON.stringify(storeModule)});
  const { loadState, closePersistence } = await import(${JSON.stringify(persistModule)});
  const { SCHEDULED_TASKS } = await import(${JSON.stringify(seedModule)});
  const { MCP_MODERN_VERSION } = await import(${JSON.stringify(new URL('../mcpProtocol.ts', import.meta.url).href)});
  const { MCP_SCHEMA_ADMISSION_VERSION, mcpToolSchemaHash } = await import(${JSON.stringify(new URL('../mcpToolAdmission.ts', import.meta.url).href)});
  store.initPersistence();
  const { id: _id, tenantId: _tenantId, ...seed } = structuredClone(SCHEDULED_TASKS[0]);
  const owner = 'tenant-personal';
  const task = store.addSchedule({ ...seed, tenantId: owner, name: 'Persistence Stop Fixture', runs: [], enabled: true,
    steps: [], delivery: { tool: { id: 'assistant', label: 'Assistant', tone: 'claude' }, target: 'Run conversation' } });
  const tool = { name: 'write', inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false } };
  const schemaHash = mcpToolSchemaHash(tool);
  const connectionId = 'mcp-connection-' + 'e'.repeat(32);
  store.createMcpConnection({ id: connectionId, label: 'Stop receipt fixture', endpoint: 'https://8.8.8.8/mcp', authentication: 'none' }, owner);
  store.commitMcpInspection(connectionId, owner, 0, { protocolVersion: MCP_MODERN_VERSION, cleanup: 'not-needed', tools: [tool],
    schemaAdmission: { version: MCP_SCHEMA_ADMISSION_VERSION, hashes: [schemaHash] } }, Date.now());
  const review = store.routineMcpReview(task.id, owner);
  if (!review) throw new Error('Routine MCP review unavailable');
  store.decideRoutineMcp(task.id, owner, { requestId: 'stop-fixture-approval', action: 'approve', approval: {
    expectedRevision: review.policy.revision, expectedDefinitionRevision: review.definitionRevision, reviewHash: review.reviewHash,
    expiresAt: Date.now() + 60_000, maxCallsPerRun: 1,
    tools: [{ connectionId, connectionRevision: 1, toolName: tool.name, schemaHash, fixedArguments: { value: 'one' } }],
  } });
  const run = store.runSchedule(task.id);
  if (!run) throw new Error('fixture run was not admitted');
  const controller = new AbortController();
  let releaseExecution;
  let enteredExecution;
  const executionEntered = new Promise(resolve => { enteredExecution = resolve; });
  const executionReleased = new Promise(resolve => { releaseExecution = resolve; });
  const execution = store.executeRoutineMcpCall(task.id, run.id,
    { connectionId, connectionRevision: 1, toolName: tool.name, schemaHash, arguments: { value: 'one' } },
    'stop-fixture-call', controller.signal, async () => {
      enteredExecution();
      await executionReleased;
      return { status: 'done', summary: 'Late completion', result: { resultType: 'complete', content: [{ type: 'text', text: 'late' }], isError: false } };
    });
  await executionEntered;
  const pendingBeforeStop = loadState()?.routineMcp?.runs.find(row => row.runId === run.id)?.calls[0]?.status;
  let cancelCalls = 0;
  let durableAtCancel;
  configureScheduleExecutor(undefined, (taskId, runId) => {
    cancelCalls++;
    if (taskId !== task.id || runId !== run.id) throw new Error('canceller received a different run');
    durableAtCancel = loadState()?.schedules.find(row => row.id === task.id)?.runs.find(row => row.id === run.id);
    const receiptAtCancel = loadState()?.routineMcp?.runs.find(row => row.runId === run.id)?.calls[0];
    durableAtCancel = { ...durableAtCancel, receiptStatus: receiptAtCancel?.status, ledgerPhase: loadState()?.routineMcp?.runs.find(row => row.runId === run.id)?.phase };
    controller.abort();
  });
  const returned = store.stopScheduleRun(task.id, run.id, owner, run.at + 1500);
  releaseExecution();
  const lateReceipt = await execution;
  const live = store.listSchedules(owner).find(row => row.id === task.id);
  const report = { taskId: task.id, runId: run.id, returned, durableAtCancel, cancelCalls,
    taskLastStatus: live?.lastStatus, pending: store.pendingScheduleRuns(), pendingBeforeStop, lateReceiptStatus: lateReceipt.status };
  closePersistence();
  console.log(JSON.stringify(report));
`;

const restart = `
  const { store } = await import(${JSON.stringify(storeModule)});
  const { loadState, closePersistence } = await import(${JSON.stringify(persistModule)});
  store.initPersistence();
  const state = loadState();
  const row = state?.schedules.flatMap(task => task.runs).find(run => run.status === 'cancelled');
  const ledger = state?.routineMcp?.runs.find(run => run.runId === row?.id);
  const pending = store.pendingScheduleRuns();
  closePersistence();
  console.log(JSON.stringify({ row, pending, receipt: ledger?.calls[0], ledgerPhase: ledger?.phase }));
`;

for (const backend of ['json', 'sqlite'] as const) {
  test(`${backend}: stop commits terminal run before cancelling and restart does not requeue`, () => {
    const file = join(root, `stopped.${backend === 'json' ? 'json' : 'db'}`)
    const result = child(createAndStop, file, backend)
    assert.equal(result.returned.status, 'cancelled')
    assert.equal(result.durableAtCancel.status, 'cancelled', 'the cancel hook observes the durable terminal snapshot')
    assert.equal(result.pendingBeforeStop, 'pending', 'the call reservation was durable before Stop')
    assert.equal(result.durableAtCancel.receiptStatus, 'uncertain', 'Stop durably converts a pending private receipt before cancellation')
    assert.equal(result.durableAtCancel.ledgerPhase, 'interrupted')
    assert.equal(result.lateReceiptStatus, 'uncertain', 'a late executor completion cannot rewrite the stopped receipt')
    assert.equal(result.cancelCalls, 1)
    assert.equal(result.taskLastStatus, 'cancelled')
    assert.deepEqual(result.pending, [])

    const reboot = child(restart, file, backend)
    assert.equal(reboot.row.id, result.runId)
    assert.equal(reboot.row.status, 'cancelled')
    assert.equal(reboot.row.summary, 'Stopped by request')
    assert.deepEqual(reboot.pending, [])
    assert.equal(reboot.receipt.status, 'uncertain', 'restart retains private uncertainty rather than replaying the call')
    assert.equal(reboot.ledgerPhase, 'interrupted')
  })
}

test('failed stop commit neither acknowledges nor invokes the worker cancel hook', () => {
  const file = join(root, 'failed-stop.json')
  const blocked = join(root, 'blocked-path')
  const failureScript = `
    const { store, configureScheduleExecutor } = await import(${JSON.stringify(storeModule)});
    const { loadState, closePersistence } = await import(${JSON.stringify(persistModule)});
    const { SCHEDULED_TASKS } = await import(${JSON.stringify(seedModule)});
    store.initPersistence();
    const { id: _id, tenantId: _tenantId, ...seed } = structuredClone(SCHEDULED_TASKS[0]);
    const owner = 'tenant-personal';
    const task = store.addSchedule({ ...seed, tenantId: owner, name: 'Failed Stop Fixture', runs: [], enabled: true,
      steps: [], delivery: { tool: { id: 'assistant', label: 'Assistant', tone: 'claude' }, target: 'Run conversation' } });
    const run = store.runSchedule(task.id);
    if (!run) throw new Error('fixture run was not admitted');
    let cancelCalls = 0;
    configureScheduleExecutor(undefined, () => { cancelCalls++; });
    process.env.DATA_FILE = ${JSON.stringify(blocked)};
    let threw = false;
    try { store.stopScheduleRun(task.id, run.id, owner, run.at + 1500); } catch { threw = true; }
    process.env.DATA_FILE = ${JSON.stringify(file)};
    const durable = loadState()?.schedules.find(row => row.id === task.id)?.runs.find(row => row.id === run.id);
    console.log(JSON.stringify({ threw, cancelCalls, durableStatus: durable?.status }));
    closePersistence();
  `
  mkdirSync(blocked, { recursive: true })
  try {
    const result = child(failureScript, file, 'json')
    assert.equal(result.threw, true, 'a failed backend commit is not an acknowledgement')
    assert.equal(result.cancelCalls, 0, 'worker interruption is strictly after persistence')
    assert.equal(result.durableStatus, 'running', 'the prior durable row remains unchanged')
  } finally {
    rmSync(blocked, { recursive: true, force: true })
  }
})
