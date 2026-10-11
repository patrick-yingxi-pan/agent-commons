/** Private MCP input state is restart-safe without making answers or pending
 * schemas part of public activity history or replaying external work. */
import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const ROOT = mkdtempSync(join(tmpdir(), `agent-commons-mcp-input-${process.pid}-`))
const STORE_MODULE = new URL('../store/index.ts', import.meta.url).href
const PERSIST_MODULE = new URL('./persist.ts', import.meta.url).href
const ACCOUNT_MODULE = new URL('../accounts.ts', import.meta.url).href
const ADMISSION_MODULE = new URL('../mcpToolAdmission.ts', import.meta.url).href
const TENANT = 'tenant-acme'
const USER = 'user-ada'
const DECISION = 'tool-activity-decision-bbbbbbbbbbbbbbbbbbbbbbbb'
const RESPONSE = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

after(() => rmSync(ROOT, { recursive: true, force: true }))

function boot(file: string, backend: 'json' | 'sqlite', work: string) {
  return spawnSync(process.execPath, ['--input-type=module', '--eval', `
    const { store } = await import(${JSON.stringify(STORE_MODULE)});
    const { closePersistence, loadState } = await import(${JSON.stringify(PERSIST_MODULE)});
    const { accounts } = await import(${JSON.stringify(ACCOUNT_MODULE)});
    store.initPersistence();
    ${work}
    closePersistence();
  `], {
    encoding: 'utf8', timeout: 20_000,
    env: { ...process.env, INITIAL_WORLD: 'demo', BACKEND: 'mock', PERSIST_BACKEND: backend,
      DATA_FILE: file, DATABASE_PATH: file },
  })
}

function output(result: ReturnType<typeof boot>): Record<string, any> {
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}

function createPendingFlowWork(mode: 'pending' | 'reserve') {
  return `
    if (!accounts.identityFor(${JSON.stringify(USER)}, ${JSON.stringify(TENANT)})) throw new Error('seeded Ada identity unavailable');
    const { mcpConnectionCreationId } = await import(${JSON.stringify(new URL('../mcpConnections.ts', import.meta.url).href)});
    const { admitMcpCatalog, mcpToolSchemaHash } = await import(${JSON.stringify(ADMISSION_MODULE)});
    const tenantId = ${JSON.stringify(TENANT)}, actorUserId = ${JSON.stringify(USER)};
    const connectionId = mcpConnectionCreationId(tenantId, 'restart-input-fixture');
    const tool = { name: 'restart.input', inputSchema: { type: 'object', properties: { request: { type: 'string' } }, required: ['request'], additionalProperties: false } };
    const schemaAdmission = await admitMcpCatalog([tool]);
    store.createMcpConnection({ id: connectionId, label: 'Restart input fixture', endpoint: 'https://mcp.example/restart-input', authentication: 'none' }, tenantId);
    store.commitMcpInspection(connectionId, tenantId, 0, { protocolVersion: '2026-07-28', cleanup: 'not-needed', tools: [tool],
      schemaAdmission }, 10);
    const session = store.createSession('Ada private MCP input restart', tenantId);
    store.attachContext(session.id, { id: connectionId, type: 'mcp', label: 'Restart input fixture', scope: '*' }, actorUserId);
    const activity = { id: 'mcp-input-restart-activity', tool: 'mcp__restart__input', connector: 'Restart input fixture',
      connectorId: connectionId, kind: 'action', status: 'proposed', summary: 'Reviewed fixture action', input: { request: 'restart-only' },
      mcp: { connectionRevision: 1, toolName: tool.name, schemaHash: mcpToolSchemaHash(tool) } };
    store.appendMessage(session.id, { id: store.mintMessageId('assistant'), role: 'assistant', content: 'Review the fixture action.', toolActivities: [activity] });
    const decisionId = ${JSON.stringify(DECISION)};
    const begun = store.beginMcpToolActivityExecution(session.id, activity.id, decisionId, tenantId, actorUserId, true);
    if (!begun || begun === 'invalid' || begun.status !== 'running') throw new Error('could not durably begin form-enabled action');
    const settled = store.settleMcpToolActivityExecution(session.id, activity.id, decisionId, tenantId, {
      status: 'awaiting-input', summary: 'Waiting for private restart input.', pending: {
        resultType: 'input_required', requestState: 'opaque-restart-state', inputRequests: { question: {
          method: 'elicitation/create', params: { mode: 'form', message: 'Provide a private choice.',
            requestedSchema: { type: 'object', properties: { choice: { type: 'string', enum: ['yes', 'no'] } }, required: ['choice'] } },
        } },
      },
    }, actorUserId);
    if (!settled || settled === 'invalid' || settled.status !== 'awaiting-input') throw new Error('could not persist pending form');
    ${mode === 'reserve' ? `
      const reservation = store.beginMcpInputResponse(session.id, activity.id, tenantId, actorUserId, {
        decisionId, round: 1, responseId: ${JSON.stringify(RESPONSE)}, action: 'respond',
        responses: { question: { action: 'accept', content: { choice: 'yes' } } },
      });
      if (!reservation || reservation === 'invalid' || reservation.kind !== 'execute') throw new Error('could not reserve private response');
    ` : ''}
    console.log(JSON.stringify({ sessionId: session.id, activityId: activity.id, connectionId, decisionId }));
  `
}

for (const backend of ['json', 'sqlite'] as const) {
  test(`${backend}: pending MCP form survives restart privately without external execution`, () => {
    const file = join(ROOT, `pending-${backend}${backend === 'sqlite' ? '.db' : '.json'}`)
    const first = output(boot(file, backend, createPendingFlowWork('pending')))
    const restored = output(boot(file, backend, `
      const activity = store.getToolActivity(${JSON.stringify(first.sessionId)}, ${JSON.stringify(first.activityId)});
      const review = store.mcpInputReview(${JSON.stringify(first.sessionId)}, ${JSON.stringify(first.activityId)}, ${JSON.stringify(TENANT)}, ${JSON.stringify(USER)});
      const publicSession = store.getSession(${JSON.stringify(first.sessionId)}, ${JSON.stringify(USER)});
      const flow = loadState().mcpInputFlows?.find(row => row.decisionId === ${JSON.stringify(first.decisionId)});
      console.log(JSON.stringify({ activity, review, publicSession, flow }));
    `))
    assert.equal(restored.activity.status, 'awaiting-input')
    assert.equal(restored.review.review.round, 1)
    assert.equal(restored.review.review.inputRequests.question.params.message, 'Provide a private choice.')
    assert.equal(JSON.stringify(restored.activity).includes('opaque-restart-state'), false)
    assert.equal(JSON.stringify(restored.activity).includes('responses'), false)
    assert.equal(restored.flow.pending.requestState, 'opaque-restart-state')
    assert.deepEqual(restored.flow.receipts, [])
    assert.equal(JSON.stringify(restored.publicSession).includes('opaque-restart-state'), false)
  })

  test(`${backend}: reserved MCP response recovers as uncertain with only its hash receipt`, () => {
    const file = join(ROOT, `reserved-${backend}${backend === 'sqlite' ? '.db' : '.json'}`)
    const first = output(boot(file, backend, createPendingFlowWork('reserve')))
    const restored = output(boot(file, backend, `
      const activity = store.getToolActivity(${JSON.stringify(first.sessionId)}, ${JSON.stringify(first.activityId)});
      const review = store.mcpInputReview(${JSON.stringify(first.sessionId)}, ${JSON.stringify(first.activityId)}, ${JSON.stringify(TENANT)}, ${JSON.stringify(USER)});
      const receipt = store.mcpInputReceipt(${JSON.stringify(first.sessionId)}, ${JSON.stringify(first.activityId)}, ${JSON.stringify(first.decisionId)}, ${JSON.stringify(RESPONSE)}, ${JSON.stringify(TENANT)}, ${JSON.stringify(USER)});
      const flow = loadState().mcpInputFlows?.find(row => row.decisionId === ${JSON.stringify(first.decisionId)});
      console.log(JSON.stringify({ activity, review, receipt, flow }));
    `))
    assert.equal(restored.activity.status, 'uncertain')
    assert.equal(restored.review.review, null)
    assert.equal(restored.receipt.action, 'respond')
    assert.equal(restored.receipt.round, 1)
    assert.equal(restored.flow.pending, undefined)
    assert.equal(restored.flow.receipts.length, 1)
    assert.equal(restored.flow.receipts[0].responseId, RESPONSE)
    assert.equal(JSON.stringify(restored.flow).includes('"responses"'), false)
    assert.equal(JSON.stringify(restored.receipt).includes('"responses"'), false)
  })
}
