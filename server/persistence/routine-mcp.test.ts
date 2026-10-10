/** Routine MCP permission and call recovery are private durable state. Exercise
 * actual JSON/SQLite boot admission in child processes so singleton store state
 * and backend handles cannot leak between cases. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

const ROOT = mkdtempSync(join(tmpdir(), `agent-commons-routine-mcp-${process.pid}-`))
const storeModule = new URL('../store/index.ts', import.meta.url).href
const persistModule = new URL('./persist.ts', import.meta.url).href
const registryModule = new URL('../routineMcpRegistry.ts', import.meta.url).href
const stateModule = new URL('../routineMcpState.ts', import.meta.url).href
const admissionModule = new URL('../mcpToolAdmission.ts', import.meta.url).href

after(() => rmSync(ROOT, { recursive: true, force: true }))

function run(file: string, backend: 'json' | 'sqlite', code: string) {
  return spawnSync(process.execPath, ['--input-type=module', '--eval', code], {
    encoding: 'utf8', timeout: 30_000,
    env: { ...process.env, INITIAL_WORLD: 'clean', BACKEND: 'mock', PERSIST_BACKEND: backend,
      DATA_FILE: file, DATABASE_PATH: file },
  })
}

function output(file: string, backend: 'json' | 'sqlite', code: string): Record<string, any> {
  const result = run(file, backend, code)
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}

function fixtureCode(callOutcome: 'pending' | 'done' = 'pending') {
  return `
    const { store } = await import(${JSON.stringify(storeModule)});
    const { loadState, saveState, closePersistence } = await import(${JSON.stringify(persistModule)});
    const { RoutineMcpRegistry } = await import(${JSON.stringify(registryModule)});
    const { reserveRoutineMcpCall, settleRoutineMcpCall } = await import(${JSON.stringify(stateModule)});
    const { mcpToolSchemaHash } = await import(${JSON.stringify(admissionModule)});
    const { SCHEDULED_TASKS } = await import(${JSON.stringify(new URL('../data/cowork.ts', import.meta.url).href)});
    store.initPersistence();
    const state = loadState();
    const task = structuredClone(SCHEDULED_TASKS[0]);
    task.id = 'routine-mcp-fixture';
    task.tenantId = 'tenant-routine-mcp-fixture';
    task.runs = [];
    state.schedules = [task];
    const definitionRevision = task.revision ?? 0;
    const now = 1800000000000;
    const connectionId = 'mcp-connection-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const tool = { name: 'write', inputSchema: { type: 'object', properties: {}, additionalProperties: true } };
    const schemaHash = mcpToolSchemaHash(tool);
    const connection = { id: connectionId, label: 'Snapshot MCP', status: 'connected', revision: 3,
      authentication: 'none', protocolVersion: '2026-07-28', inspectedAt: now, tools: [tool],
      execution: 'approval-required', executableTools: ['write'] };
    const registry = new RoutineMcpRegistry();
    registry.decide({ tenantId: task.tenantId, routineId: task.id }, {
      requestId: 'approval-snapshot', action: 'approve', approval: {
        expectedRevision: 0, expectedDefinitionRevision: definitionRevision, reviewHash: 'a'.repeat(64),
        expiresAt: now + 3600000, maxCallsPerRun: 3,
        tools: [{ connectionId, connectionRevision: 3, toolName: 'write', schemaHash, fixedArguments: {} }],
      },
    }, { definitionRevision, reviewHash: 'a'.repeat(64), now,
      connection: (id, owner) => id === connectionId && owner === task.tenantId ? connection : undefined });
    const permission = registry.policy(task.tenantId, task.id);
    const runId = 'routine-mcp-recovery-run';
    const run = registry.queue(permission, runId);
    const reserved = reserveRoutineMcpCall(run, { key: 'snapshot-call',
      call: { connectionId, connectionRevision: 3, toolName: 'write', schemaHash, arguments: {} },
      live: permission, definitionRevision, reviewHash: 'a'.repeat(64), now: now + 1,
      connection: (id, owner) => id === connectionId && owner === task.tenantId ? connection : undefined });
    registry.setRun(reserved.run);
    if (${JSON.stringify(callOutcome)} === 'done') {
      registry.setRun(settleRoutineMcpCall(reserved.run, reserved.receipt.id, {
        status: 'done', summary: 'Known result before model completion.',
        result: { resultType: 'complete', content: [{ type: 'text', text: 'Known durable result.' }], isError: false },
      }, now + 2));
    }
    task.runs.unshift({ id: runId, status: 'running', duration: '—', reachedStep: 0, summary: 'Queued', at: now,
      attempts: 1, maxAttempts: 3, nextAttemptAt: now + 1,
      execution: { definitionRevision, trigger: task.trigger, prompt: task.prompt, steps: task.steps,
        delivery: task.delivery, agentId: task.agentId ?? 'agent-snapshot', providerId: task.providerId ?? 'provider-snapshot' } });
    state.routineMcp = registry.snapshot();
    saveState(state);
    console.log(JSON.stringify({ routineId: task.id, tenantId: task.tenantId, runId }));
    closePersistence();
  `
}

for (const backend of ['json', 'sqlite'] as const) {
  test(`${backend}: pending Routine MCP call is durably made uncertain and the routine is paused before admission`, () => {
    const file = join(ROOT, `pending-${backend}`)
    const fixture = output(file, backend, fixtureCode())

    const recovered = output(file, backend, `
      const { store } = await import(${JSON.stringify(storeModule)});
      const { loadState, closePersistence } = await import(${JSON.stringify(persistModule)});
      store.initPersistence();
      const state = loadState();
      const task = state.schedules.find(row => row.id === ${JSON.stringify(fixture.routineId)});
      const run = task.runs.find(row => row.id === ${JSON.stringify(fixture.runId)});
      const ledger = state.routineMcp.runs.find(row => row.runId === ${JSON.stringify(fixture.runId)});
      console.log(JSON.stringify({ status: run.status, failureCode: run.failureCode, enabled: task.enabled,
        call: ledger.calls[0], approval: state.routineMcp.policies[0].policy.approval,
        pending: store.pendingScheduleRuns() }));
      closePersistence();
    `)
    assert.equal(recovered.status, 'failed')
    assert.equal(recovered.failureCode, 'execution_error')
    assert.equal(recovered.enabled, false)
    assert.equal(recovered.call.status, 'uncertain', 'unknown external effect is not treated as a failure without effect')
    assert.equal(recovered.approval, null, 'restart recovery suspends current authority')
    assert.deepEqual(recovered.pending, [], 'the interrupted model prompt is never automatically retried')

    const second = output(file, backend, `
      const { store } = await import(${JSON.stringify(storeModule)});
      const { loadState, closePersistence } = await import(${JSON.stringify(persistModule)});
      store.initPersistence();
      const state = loadState();
      const ledger = state.routineMcp.runs.find(row => row.runId === ${JSON.stringify(fixture.runId)});
      console.log(JSON.stringify({ phase: ledger.phase, status: ledger.calls[0].status,
        approval: state.routineMcp.policies[0].policy.approval }));
      closePersistence();
    `)
    assert.equal(second.phase, 'interrupted')
    assert.equal(second.status, 'uncertain', 'restarting again does not duplicate or rewrite recovery')
    assert.equal(second.approval, null)
  })

  test(`${backend}: known Routine MCP result survives recovery when the model run was still running`, () => {
    const file = join(ROOT, `known-result-${backend}`)
    const fixture = output(file, backend, fixtureCode('done'))

    const recovered = output(file, backend, `
      const { store } = await import(${JSON.stringify(storeModule)});
      const { loadState, closePersistence } = await import(${JSON.stringify(persistModule)});
      store.initPersistence();
      const state = loadState();
      const task = state.schedules.find(row => row.id === ${JSON.stringify(fixture.routineId)});
      const run = task.runs.find(row => row.id === ${JSON.stringify(fixture.runId)});
      const ledger = state.routineMcp.runs.find(row => row.runId === ${JSON.stringify(fixture.runId)});
      console.log(JSON.stringify({ status: run.status, failureCode: run.failureCode, enabled: task.enabled,
        phase: ledger.phase, call: ledger.calls[0], approval: state.routineMcp.policies[0].policy.approval,
        pending: store.pendingScheduleRuns() }));
      closePersistence();
    `)
    assert.equal(recovered.status, 'failed', 'recovery fails the run whose prompt did not finish')
    assert.equal(recovered.failureCode, 'execution_error')
    assert.equal(recovered.enabled, false, 'recovery pauses the Routine')
    assert.equal(recovered.phase, 'interrupted')
    assert.equal(recovered.call.status, 'done', 'a known completed effect is never rewritten as uncertain')
    assert.equal(recovered.call.result.content[0].text, 'Known durable result.')
    assert.equal(recovered.approval, null, 'recovery suspends current authority')
    assert.deepEqual(recovered.pending, [], 'the interrupted model prompt is never automatically retried')

    const second = output(file, backend, `
      const { store } = await import(${JSON.stringify(storeModule)});
      const { loadState, closePersistence } = await import(${JSON.stringify(persistModule)});
      store.initPersistence();
      const state = loadState();
      const task = state.schedules.find(row => row.id === ${JSON.stringify(fixture.routineId)});
      const run = task.runs.find(row => row.id === ${JSON.stringify(fixture.runId)});
      const ledger = state.routineMcp.runs.find(row => row.runId === ${JSON.stringify(fixture.runId)});
      console.log(JSON.stringify({ status: run.status, phase: ledger.phase, call: ledger.calls[0],
        approval: state.routineMcp.policies[0].policy.approval, pending: store.pendingScheduleRuns() }));
      closePersistence();
    `)
    assert.equal(second.status, 'failed')
    assert.equal(second.phase, 'interrupted')
    assert.equal(second.call.status, 'done', 'the second restart preserves the known result exactly')
    assert.equal(second.call.result.content[0].text, 'Known durable result.')
    assert.equal(second.approval, null)
    assert.deepEqual(second.pending, [])
  })

  test(`${backend}: absent legacy Routine MCP slice is accepted; malformed joins fail closed`, () => {
    const file = join(ROOT, `legacy-${backend}`)
    output(file, backend, `
      const { store } = await import(${JSON.stringify(storeModule)});
      const { loadState, saveState, closePersistence } = await import(${JSON.stringify(persistModule)});
      store.initPersistence();
      const state = loadState();
      delete state.routineMcp;
      saveState(state);
      console.log(JSON.stringify({ absent: true }));
      closePersistence();
    `)
    output(file, backend, `
      const { store } = await import(${JSON.stringify(storeModule)});
      store.initPersistence();
      console.log(JSON.stringify({ started: true }));
    `)

    const invalidJoins = [
      ['wrong-owner-routine', `state.schedules[0].tenantId = 'tenant-foreign';`],
      ['unjoined-run', `
        const { createRoutineMcpRun } = await import(${JSON.stringify(stateModule)});
        state.routineMcp.runs.push(createRoutineMcpRun(state.routineMcp.policies[0], 'unjoined-run'));
      `],
    ] as const
    for (const [label, mutation] of invalidJoins) {
      const invalidFile = join(ROOT, `${label}-${backend}`)
      output(invalidFile, backend, fixtureCode())
      const tamper = run(invalidFile, backend, `
        const { loadState, saveState, closePersistence } = await import(${JSON.stringify(persistModule)});
        const state = loadState();
        ${mutation}
        saveState(state);
        closePersistence();
      `)
      assert.equal(tamper.status, 0, tamper.stderr)
      const rejected = run(invalidFile, backend, `
        const { store } = await import(${JSON.stringify(storeModule)});
        store.initPersistence();
      `)
      assert.notEqual(rejected.status, 0, `${label} present-state join must stop startup`)
    }
  })
}
