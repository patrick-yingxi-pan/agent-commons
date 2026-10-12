/** Project-work draft source provenance and its original private prompt survive
 * JSON/SQLite restart. Running work is interrupted before admission and never
 * replayed; malformed present provenance refuses persisted-state admission. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { after, test } from 'node:test'
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = mkdtempSync(join(tmpdir(), `agent-commons-project-work-draft-${process.pid}-`))
const storeModule = new URL('../store/index.ts', import.meta.url).href
const persistenceModule = new URL('./persist.ts', import.meta.url).href
const identityModule = new URL('../dispatchIdentity.ts', import.meta.url).href
const accountsModule = new URL('../accounts.ts', import.meta.url).href
const mcpProtocolModule = new URL('../mcpProtocol.ts', import.meta.url).href
const mcpAdmissionModule = new URL('../mcpToolAdmission.ts', import.meta.url).href
const TENANT = 'project-work-draft-durability-owner'
const KEY = 'project-work-draft-replay-key'
const SUB_GOAL = 'Prepare the frozen migration review'
const NOTE = 'Use only this source text; no changes are authorized.'

after(() => rmSync(ROOT, { recursive: true, force: true }))

function boot(file: string, backend: 'json' | 'sqlite', work: string, key = KEY) {
  return spawnSync(process.execPath, ['--input-type=module', '--eval', `
    const { store } = await import(${JSON.stringify(storeModule)});
    const { closePersistence, loadState, saveState } = await import(${JSON.stringify(persistenceModule)});
    const { manualDispatchRunId } = await import(${JSON.stringify(identityModule)});
    const { accounts } = await import(${JSON.stringify(accountsModule)});
    const { MCP_MODERN_VERSION } = await import(${JSON.stringify(mcpProtocolModule)});
    const { MCP_SCHEMA_ADMISSION_VERSION, mcpToolSchemaHash } = await import(${JSON.stringify(mcpAdmissionModule)});
    store.initPersistence();
    const dispatchId = manualDispatchRunId(${JSON.stringify(TENANT)}, ${JSON.stringify(key)});
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
}

function output(result: ReturnType<typeof boot>): Record<string, any> {
  assert.equal(result.status, 0, `fresh persistence process failed:\n${result.stderr}`)
  return JSON.parse(result.stdout)
}

for (const backend of ['json', 'sqlite'] as const) {
  test(`${backend}: Project-work draft preserves source and first prompt, then recovers interrupted without replay`, () => {
    const file = join(ROOT, `valid-${backend}`)
    const first = output(boot(file, backend, `
      const provider = store.createProvider({
        label: 'Durable project draft provider', modelFamily: 'claude', effortLevels: ['Low'],
        models: [{ id: 'durable-draft-model', label: 'Durable draft model' }],
      }, {}, ${JSON.stringify(TENANT)});
      const agent = store.createAgent({
        label: 'Durable project draft Agent', systemPrompt: 'Draft clearly.', instructions: '',
        tools: [], providerId: provider.id,
      }, ${JSON.stringify(TENANT)});
      const projectId = 'project-work-draft-durable-source';
      store.applyRelationOp({ kind: 'create-project', projectId, projectName: 'Durable source', projectDescription: 'Frozen description.' }, ${JSON.stringify(TENANT)});
      store.applyRelationOp({ kind: 'set-project-instructions', projectId, projectName: 'Durable source', instructions: 'Owner private instruction.' }, ${JSON.stringify(TENANT)});
      const commission = store.createCommission({ role: 'reader', agentId: agent.id, projectId }, ${JSON.stringify(TENANT)});
      const item = store.postOpenSubGoal(projectId, { subGoal: ${JSON.stringify(SUB_GOAL)}, type: 'mcp.mutate', target: 'write_record', note: ${JSON.stringify(NOTE)} }, ${JSON.stringify(TENANT)});
      const userId = 'project-work-draft-durable-person';
      assert.ok(accounts.createUser('Durable person', 'durable-project-draft@example.test', 'fixture-password', { userId, tenantId: ${JSON.stringify(TENANT)} }));
      const connectionId = 'mcp-connection-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      const tool = { name: 'write_record', description: 'Write a draft.', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false } };
      store.createMcpConnection({ transport: 'stdio', id: connectionId, label: 'Durable local writer' }, ${JSON.stringify(TENANT)}, false, userId);
      store.commitMcpInspection(connectionId, ${JSON.stringify(TENANT)}, 0, { protocolVersion: MCP_MODERN_VERSION, cleanup: 'not-needed', tools: [tool], schemaAdmission: { version: MCP_SCHEMA_ADMISSION_VERSION, hashes: [mcpToolSchemaHash(tool)] } }, Date.now(), undefined, undefined, userId, 'MCP_STDIO_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
      const projectWork = { projectId, itemId: item.id, commissionId: commission.id, expectedRevision: commission.configurationRevision ?? 0 };
      const execution = { agentId: agent.id, providerId: provider.id, modelId: 'durable-draft-model' };
      const mcpProposal = { connectionId, connectionRevision: 1, toolName: tool.name };
      const run = store.startProjectWorkDraft({ projectWork, execution, mcpProposal }, ${JSON.stringify(TENANT)}, dispatchId, userId);
      const session = store.getSession(run.execution.sessionId);
      const durable = loadState();
      console.log(JSON.stringify({ run, projectWork, execution, session,
        storedRun: durable.dispatch.find(row => row.id === dispatchId),
        storedItem: durable.openSubGoals.find(row => row.id === item.id),
        storedCommission: durable.commissions.find(([id]) => id === commission.id)?.[1],
        storedProject: durable.graph.extraProjects.find(row => row.id === projectId), mcpProposal,
        connection: durable.mcpConnections.connections.find(row => row.id === connectionId) }));
    `))

    assert.equal(first.run.execution.state, 'running')
    assert.deepEqual(first.run.execution.projectWork, first.projectWork)
    assert.deepEqual(first.storedRun.execution.projectWork, first.projectWork)
    assert.deepEqual(first.storedRun.execution.mcpProposal, first.run.execution.mcpProposal)
    assert.equal(first.run.execution.mcpProposal.transport, 'stdio')
    assert.match(first.run.execution.mcpProposal.bindingHash, /^[a-f0-9]{64}$/)
    assert.equal(first.run.execution.mcpProposal.connectionLabel, 'Durable local writer')
    assert.equal(first.session.messages.length, 1)
    assert.equal(first.session.messages[0].content, `${first.run.title}\n\n${first.run.detail}`)
    assert.match(first.session.messages[0].content, /"name":\s*"write_record"/)
    assert.doesNotMatch(first.session.messages[0].content, /bindingHash|connectionId|MCP_STDIO_|grantReference/)
    assert.equal(first.storedItem.status, 'open')
    assert.equal(first.storedCommission.configurationRevision, first.projectWork.expectedRevision)
    assert.equal(first.storedProject.name, 'Durable source')

    const recovered = output(boot(file, backend, `
      const rowOnDiskBeforeRetry = loadState().dispatch.find(candidate => candidate.id === dispatchId);
      const run = store.getRealDispatch(dispatchId, ${JSON.stringify(TENANT)});
      const session = run && run !== 'retired' ? store.getSession(run.execution.sessionId) : undefined;
      const project = store.listProjects(${JSON.stringify(TENANT)}).find(candidate => candidate.id === ${JSON.stringify(first.projectWork.projectId)});
      const item = store.listOpenSubGoals(${JSON.stringify(first.projectWork.projectId)}, ${JSON.stringify(TENANT)}).find(candidate => candidate.id === ${JSON.stringify(first.projectWork.itemId)});
      const commission = store.getCommission(${JSON.stringify(first.projectWork.commissionId)});
      const retry = store.startProjectWorkDraft({
        projectWork: { projectId: 'changed-project', itemId: 'changed-item', commissionId: 'changed-commission', expectedRevision: 999 },
        execution: { agentId: 'changed-agent', providerId: 'changed-provider', modelId: 'changed-model' },
        mcpProposal: { connectionId: 'changed', connectionRevision: 999, toolName: 'changed' },
      }, ${JSON.stringify(TENANT)}, dispatchId);
      console.log(JSON.stringify({ rowOnDiskBeforeRetry, run, retry, session, project, item, commission,
        durableAfterRetry: loadState().dispatch.find(candidate => candidate.id === dispatchId),
        runs: store.listDispatch(${JSON.stringify(TENANT)}).filter(candidate => candidate.id === dispatchId),
        sessions: store.listSessions(${JSON.stringify(TENANT)}).filter(candidate => candidate.id === ${JSON.stringify(first.run.execution.sessionId)}) }));
    `))

    assert.equal(recovered.rowOnDiskBeforeRetry.execution.state, 'interrupted', 'restart recovery is committed before reads/admission')
    assert.equal(recovered.rowOnDiskBeforeRetry.status, 'failed')
    assert.deepEqual(recovered.run, recovered.rowOnDiskBeforeRetry)
    assert.deepEqual(recovered.retry, recovered.run, 'replay returns represented interrupted truth before changed source/binding admission')
    assert.deepEqual(recovered.durableAfterRetry, recovered.rowOnDiskBeforeRetry, 'replay performs no write or generation retry')
    assert.equal(recovered.session.messages.length, 1, 'no assistant result is fabricated or replayed')
    assert.equal(recovered.session.messages[0].content, first.session.messages[0].content, 'the first frozen prompt survives restart')
    assert.deepEqual(recovered.run.execution.projectWork, first.projectWork, 'the original Project/item/Commission revision remains frozen')
    assert.deepEqual(recovered.run.execution.mcpProposal, first.run.execution.mcpProposal, 'the safe preview survives restart unchanged')
    assert.equal(recovered.project.instructions, 'Owner private instruction.')
    assert.equal(recovered.item.status, 'open')
    assert.equal(recovered.commission.configurationRevision, first.projectWork.expectedRevision)
    assert.equal(recovered.runs.length, 1)
    assert.equal(recovered.sessions.length, 1)
  })

  test(`${backend}: prose-only Project-work draft keeps its legacy optional-provenance shape`, () => {
    const key = `${KEY}-prose-only`
    const file = join(ROOT, `prose-${backend}`)
    const first = output(boot(file, backend, `
      const provider = store.createProvider({ label: 'Prose provider', modelFamily: 'claude', effortLevels: ['Low'], models: [{ id: 'prose-model', label: 'Prose model' }] }, {}, ${JSON.stringify(TENANT)});
      const agent = store.createAgent({ label: 'Prose Agent', systemPrompt: 'Draft.', instructions: '', tools: [], providerId: provider.id }, ${JSON.stringify(TENANT)});
      const projectId = 'project-work-draft-prose-source';
      store.applyRelationOp({ kind: 'create-project', projectId, projectName: 'Prose source', projectDescription: 'Plain response context.' }, ${JSON.stringify(TENANT)});
      const commission = store.createCommission({ role: 'reader', agentId: agent.id, projectId }, ${JSON.stringify(TENANT)});
      const item = store.postOpenSubGoal(projectId, { subGoal: 'Write a prose response', type: 'read', target: 'source', note: 'Do not claim completion.' }, ${JSON.stringify(TENANT)});
      const projectWork = { projectId, itemId: item.id, commissionId: commission.id, expectedRevision: commission.configurationRevision ?? 0 };
      const run = store.startProjectWorkDraft({ projectWork, execution: { agentId: agent.id, providerId: provider.id, modelId: 'prose-model' } }, ${JSON.stringify(TENANT)}, dispatchId);
      console.log(JSON.stringify({ run, prompt: store.getSession(run.execution.sessionId).messages[0].content }));
    `, key))
    assert.equal(first.run.execution.state, 'running')
    assert.equal(Object.hasOwn(first.run.execution, 'mcpProposal'), false)
    assert.match(first.prompt, /Plain response context/)
    const recovered = output(boot(file, backend, `
      const run = store.getRealDispatch(dispatchId, ${JSON.stringify(TENANT)});
      const session = run && run !== 'retired' ? store.getSession(run.execution.sessionId) : undefined;
      const replay = store.startProjectWorkDraft({ projectWork: {}, execution: {} }, ${JSON.stringify(TENANT)}, dispatchId);
      console.log(JSON.stringify({ run, replay, session }));
    `, key))
    assert.equal(recovered.run.execution.state, 'interrupted')
    assert.deepEqual(recovered.replay, recovered.run)
    assert.equal(recovered.session.messages.length, 1)
    assert.equal(recovered.session.messages[0].content, first.prompt)
    assert.equal(Object.hasOwn(recovered.run.execution, 'mcpProposal'), false)
  })

  test(`${backend}: malformed persisted Project-work source refuses startup without rewriting bytes`, () => {
    const baseFile = join(ROOT, `invalid-base-${backend}`)
    const seeded = output(boot(baseFile, backend, `
      const provider = store.createProvider({ label: 'Admission provider', modelFamily: 'claude', effortLevels: ['Low'], models: [{ id: 'admission-model', label: 'Admission model' }] }, {}, ${JSON.stringify(TENANT)});
      const agent = store.createAgent({ label: 'Admission Agent', systemPrompt: 'Draft.', instructions: '', tools: [], providerId: provider.id }, ${JSON.stringify(TENANT)});
      const projectId = 'project-work-draft-admission-source';
      store.applyRelationOp({ kind: 'create-project', projectId, projectName: 'Admission source', projectDescription: '' }, ${JSON.stringify(TENANT)});
      const commission = store.createCommission({ role: 'reader', agentId: agent.id, projectId }, ${JSON.stringify(TENANT)});
      const item = store.postOpenSubGoal(projectId, { subGoal: 'Admission item', type: 'mcp.mutate', target: 'write_record', note: '' }, ${JSON.stringify(TENANT)});
      const userId = 'project-work-draft-admission-person';
      assert.ok(accounts.createUser('Admission person', 'admission-project-draft@example.test', 'fixture-password', { userId, tenantId: ${JSON.stringify(TENANT)} }));
      const connectionId = 'mcp-connection-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
      const tool = { name: 'write_record', inputSchema: { type: 'object' } };
      store.createMcpConnection({ transport: 'stdio', id: connectionId, label: 'Admission local writer' }, ${JSON.stringify(TENANT)}, false, userId);
      store.commitMcpInspection(connectionId, ${JSON.stringify(TENANT)}, 0, { protocolVersion: MCP_MODERN_VERSION, cleanup: 'not-needed', tools: [tool], schemaAdmission: { version: MCP_SCHEMA_ADMISSION_VERSION, hashes: [mcpToolSchemaHash(tool)] } }, Date.now(), undefined, undefined, userId, 'MCP_STDIO_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB');
      const run = store.startProjectWorkDraft({ projectWork: { projectId, itemId: item.id, commissionId: commission.id, expectedRevision: 0 }, execution: { agentId: agent.id, providerId: provider.id, modelId: 'admission-model' }, mcpProposal: { connectionId, connectionRevision: 1, toolName: tool.name } }, ${JSON.stringify(TENANT)}, dispatchId, userId);
      console.log(JSON.stringify({ runId: run.id }));
    `))

    const corruptions = [
      ['missing field', `delete row.execution.projectWork.commissionId;`],
      ['unknown field', `row.execution.projectWork.completed = true;`],
      ['invalid revision', `row.execution.projectWork.expectedRevision = -1;`],
      ['malformed MCP preview', `row.execution.mcpProposal = { transport: 'stdio', connectionLabel: 'Local', toolName: 'write_record', bindingHash: 'not-a-hash' };`],
    ] as const
    for (const [label, mutation] of corruptions) {
      const file = join(ROOT, `invalid-${backend}-${label.replaceAll(' ', '-')}`)
      copyFileSync(baseFile, file)
      const corrupted = boot(file, backend, `
        const state = loadState();
        const row = state.dispatch.find(candidate => candidate.id === dispatchId);
        ${mutation}
        saveState(state);
        console.log(JSON.stringify({ run: row }));
      `)
      assert.equal(corrupted.status, 0, `${backend}: prepared corrupted ${label} snapshot is writable`)
      const bytesBeforeRefusal = readFileSync(file)
      const refused = boot(file, backend, `console.log(JSON.stringify({ admitted: true }));`)
      assert.notEqual(refused.status, 0, `${backend}: malformed ${label} source must refuse startup`)
      assert.match(`${refused.stderr}\n${refused.stdout}`, /unreadable or incompatible|missing required core slices|invalid/i)
      assert.deepEqual(readFileSync(file), bytesBeforeRefusal, `${backend}: refused source bytes remain intact for recovery`)
    }
  })
}
