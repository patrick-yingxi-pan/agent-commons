/** External MCP approval is a durable single-attempt receipt. A restart may
 * not replay a call whose submission is unknown: boot converts running to
 * uncertain and commits that recovery through both production backends. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

const ROOT = mkdtempSync(join(tmpdir(), `agent-commons-mcp-execution-${process.pid}-`))
const storeModule = new URL('../store/index.ts', import.meta.url).href
const persistenceModule = new URL('./persist.ts', import.meta.url).href
const formatModule = new URL('./format.ts', import.meta.url).href
const connectorToolsModule = new URL('../model/connectorTools.ts', import.meta.url).href
const connectorRuntimeModule = new URL('../connectorRuntime.ts', import.meta.url).href
const returnedText = 'durable result\u0000\u000c\u001b[31m\u0085 café 🧪'
const returnedResult = {
  resultType: 'complete', isError: false,
  content: [
    { type: 'text', text: returnedText },
    { type: 'resource', resource: { uri: 'urn:returned-text', text: returnedText } },
  ],
  structuredContent: { content: returnedText },
}

after(() => rmSync(ROOT, { recursive: true, force: true }))

function boot(file: string, backend: 'json' | 'sqlite', work: string) {
  return spawnSync(process.execPath, ['--input-type=module', '--eval', `
    const { store } = await import(${JSON.stringify(storeModule)});
    const { loadState, closePersistence } = await import(${JSON.stringify(persistenceModule)});
    store.initPersistence();
    ${work}
    closePersistence();
  `], {
    encoding: 'utf8', timeout: 20_000,
    env: { ...process.env, INITIAL_WORLD: 'clean', BACKEND: 'mock', PERSIST_BACKEND: backend,
      DATA_FILE: file, DATABASE_PATH: file },
  })
}

function output(result: ReturnType<typeof boot>): Record<string, any> {
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}

for (const backend of ['json', 'sqlite'] as const) {
  test(`${backend}: running MCP execution recovers durably as uncertain without replay authority`, () => {
    const file = join(ROOT, `running-${backend}`)
    const first = output(boot(file, backend, `
      const session = store.createSession('Interrupted external execution');
      const activity = {
        id: 'mcp-interrupted', tool: 'mcp__saved__write', connector: 'Saved MCP',
        connectorId: 'mcp-connection-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', kind: 'action', status: 'proposed',
        summary: 'Proposed', input: { value: 'once' },
        mcp: { connectionRevision: 1, toolName: 'write', schemaHash: 'e'.repeat(64) },
      };
      store.appendMessage(session.id, { id: store.mintMessageId('assistant'), role: 'assistant', content: 'Review.', toolActivities: [activity] });
      const receipt = 'tool-activity-decision-eeeeeeeeeeeeeeeeeeeeeeee';
      store.beginMcpToolActivityExecution(session.id, activity.id, receipt, store.defaultTenantId());
      const completeSession = store.createSession('Completed external execution');
      const complete = { ...activity, id: 'mcp-complete', status: 'proposed', summary: 'Proposed again', decisionId: undefined };
      store.appendMessage(completeSession.id, { id: store.mintMessageId('assistant'), role: 'assistant', content: 'Review another.', toolActivities: [complete] });
      const completeReceipt = 'tool-activity-decision-ffffffffffffffffffffffff';
      store.beginMcpToolActivityExecution(completeSession.id, complete.id, completeReceipt, store.defaultTenantId());
      store.settleMcpToolActivityExecution(completeSession.id, complete.id, completeReceipt, store.defaultTenantId(), {
        status: 'done', summary: 'Completed', result: ${JSON.stringify(returnedResult)},
      });
      if (store.getToolActivity(completeSession.id, complete.id)?.status !== 'done') throw new Error('The valid control-bearing result must settle before compaction');
      for (let index = 0; index < 6; index += 1) {
        store.appendMessage(completeSession.id, { id: store.mintMessageId(index % 2 === 0 ? 'user' : 'assistant'), role: index % 2 === 0 ? 'user' : 'assistant', content: 'Compaction filler ' + index });
      }
      const compaction = store.prepareSessionCompaction(completeSession.id);
      if (!compaction || compaction === 'nothing-to-compact') throw new Error('expected terminal receipt to be compactable');
      store.applySessionCompaction(compaction, 'The completed external call is preserved in the archive.');
      const { deriveConnectorTools, runConnectorTool } = await import(${JSON.stringify(connectorToolsModule)});
      const { unconfiguredConnectorRuntime } = await import(${JSON.stringify(connectorRuntimeModule)});
      const failedTool = { name: 'checked-write', inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false } };
      const failedConnection = { id: activity.connectorId, label: activity.connector, status: 'connected', revision: 1,
        authentication: 'none', protocolVersion: '2026-07-28', inspectedAt: 1, tools: [failedTool],
        execution: 'approval-required', executableTools: [failedTool.name] };
      const derived = deriveConnectorTools([{ id: activity.connectorId, type: 'mcp', label: activity.connector, scope: '*' }], { externalMcpConnections: [failedConnection] });
      const failed = await runConnectorTool(derived.definitions[0].name, derived.bindings, 'mcp-invalid-before-proposal', {}, unconfiguredConnectorRuntime);
      store.appendMessage(session.id, { id: store.mintMessageId('assistant'), role: 'assistant', content: 'Invalid external call.', toolActivities: [failed] });
      console.log(JSON.stringify({ sessionId: session.id, completeSessionId: completeSession.id, failedId: failed.id, receipt, completeReceipt }));
    `))

    const recovered = output(boot(file, backend, `
      const activity = store.getToolActivity(${JSON.stringify(first.sessionId)}, 'mcp-interrupted');
      const completeActive = store.getToolActivity(${JSON.stringify(first.completeSessionId)}, 'mcp-complete');
      const complete = store.getToolActivityDecision(${JSON.stringify(first.completeSessionId)}, 'mcp-complete', ${JSON.stringify(first.completeReceipt)}, store.defaultTenantId(), 'confirm');
      const failedBeforeProposal = store.getToolActivity(${JSON.stringify(first.sessionId)}, ${JSON.stringify(first.failedId)});
      const replay = store.beginMcpToolActivityExecution(${JSON.stringify(first.sessionId)}, 'mcp-interrupted', ${JSON.stringify(first.receipt)}, store.defaultTenantId());
      const audit = store.listAuditLog(store.defaultTenantId()).filter(row => row.capability === 'mcp.call');
      console.log(JSON.stringify({ activity, completeActive, complete, failedBeforeProposal, replay, audit }));
    `))
    assert.equal(recovered.activity.status, 'uncertain')
    assert.equal(recovered.activity.decisionId, first.receipt)
    assert.equal(recovered.replay.status, 'uncertain', 'the represented receipt cannot reacquire execution')
    assert.equal(recovered.completeActive, undefined, 'active execution lookup does not reopen an archived call')
    assert.equal(recovered.complete.status, 'done')
    assert.deepEqual(recovered.complete.mcpResult, returnedResult, 'exact control-bearing text survives compaction and process restart')
    assert.equal(recovered.failedBeforeProposal.status, 'failed')
    assert.equal(recovered.failedBeforeProposal.decisionId, undefined, 'pre-proposal validation failure has no consent receipt')
    assert.equal(recovered.failedBeforeProposal.mcpResult, undefined)
    assert.equal(recovered.audit[0]?.outcome, 'uncertain')

    const durable = output(boot(file, backend, `
      const state = loadState();
      const activity = state.sessions.flatMap(session => session.messages ?? []).flatMap(message => message.toolActivities ?? []).find(row => row.id === 'mcp-interrupted');
      const audits = state.auditLog.filter(row => row.capability === 'mcp.call' && row.outcome === 'uncertain');
      console.log(JSON.stringify({ activity, audits }));
    `))
    assert.equal(durable.activity.status, 'uncertain', 'startup recovery was saved before later admission')
    assert.equal(durable.audits.length, 1, 'a later restart does not duplicate the recovery audit')

    const admission = output(boot(file, backend, `
      const { hasCorePersistedShape } = await import(${JSON.stringify(formatModule)});
      const state = loadState();
      const locate = candidate => candidate.sessions.flatMap(session => [...(session.messages ?? []), ...(session.compactedMessages ?? [])]).flatMap(message => message.toolActivities ?? []);
      const runningWithResult = structuredClone(state);
      const uncertain = locate(runningWithResult).find(row => row.id === 'mcp-interrupted');
      uncertain.status = 'running';
      uncertain.mcpResult = { resultType: 'complete', content: [], isError: false };
      const doneWithoutResult = structuredClone(state);
      const done = locate(doneWithoutResult).find(row => row.id === 'mcp-complete');
      delete done.mcpResult;
      const failedWithSuccess = structuredClone(state);
      const failed = locate(failedWithSuccess).find(row => row.id === 'mcp-complete');
      failed.status = 'failed';
      const malformedContent = structuredClone(state);
      const malformed = locate(malformedContent).find(row => row.id === 'mcp-complete');
      malformed.mcpResult.content = [{ type: 'text' }];
      const returnedErrorWithoutReceipt = structuredClone(state);
      const returnedError = locate(returnedErrorWithoutReceipt).find(row => row.id === 'mcp-complete');
      returnedError.status = 'failed';
      returnedError.mcpResult.isError = true;
      delete returnedError.decisionId;
      console.log(JSON.stringify({
        runningWithResult: hasCorePersistedShape(runningWithResult),
        doneWithoutResult: hasCorePersistedShape(doneWithoutResult),
        failedWithSuccess: hasCorePersistedShape(failedWithSuccess),
        malformedContent: hasCorePersistedShape(malformedContent),
        returnedErrorWithoutReceipt: hasCorePersistedShape(returnedErrorWithoutReceipt),
      }));
    `))
    assert.deepEqual(admission, {
      runningWithResult: false, doneWithoutResult: false, failedWithSuccess: false,
      malformedContent: false, returnedErrorWithoutReceipt: false,
    })
  })
}
