import assert from 'node:assert/strict'
import test from 'node:test'
import type { ToolActivity } from '../../contract/index.ts'
import { ConflictError, ValidationError } from '../conflict.ts'
import { MCP_SCHEMA_ADMISSION_VERSION, mcpToolSchemaHash } from '../mcpToolAdmission.ts'
import { MCP_MODERN_VERSION } from '../mcpProtocol.ts'
import { store } from './index.ts'

test('external MCP consent persists running before settlement and one receipt owns every state', () => {
  const session = store.createSession(`mcp durable ${Date.now()}`)
  const activity: ToolActivity = {
    id: `mcp-call-${Date.now()}`, tool: 'mcp__saved__write', connector: 'Saved MCP',
    connectorId: 'mcp-connection-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', kind: 'action', status: 'proposed',
    summary: 'Proposed', input: { text: 'exact' },
    mcp: { connectionRevision: 2, toolName: 'write', schemaHash: 'a'.repeat(64) },
  }
  store.appendMessage(session.id, { id: store.mintMessageId('assistant'), role: 'assistant', content: 'Review this call.', toolActivities: [activity] })
  const receipt = 'tool-activity-decision-000000000000000000000000'
  const running = store.beginMcpToolActivityExecution(session.id, activity.id, receipt, store.defaultTenantId())
  assert.equal(typeof running, 'object')
  assert.equal(running && running !== 'invalid' ? running.status : undefined, 'running')
  assert.equal(store.getToolActivityDecision(session.id, activity.id, receipt, store.defaultTenantId(), 'confirm'), running)
  assert.equal(store.beginMcpToolActivityExecution(session.id, activity.id, receipt, store.defaultTenantId()), running)
  assert.equal(store.beginMcpToolActivityExecution(session.id, activity.id, `tool-activity-decision-${'1'.repeat(24)}`, store.defaultTenantId()), 'invalid')

  const result = { resultType: 'complete' as const, content: [{ type: 'text' as const, text: 'accepted' }], isError: false }
  const auditCountBeforeInvalidSettlement = store.listAuditLog(store.defaultTenantId()).length
  for (const invalidOutcome of [
    { status: 'bogus', summary: 'Unknown outcome', result },
    { status: 'done', summary: '', result },
    { status: 'done', summary: 'x'.repeat(4_001), result },
  ]) {
    assert.equal(store.settleMcpToolActivityExecution(
      session.id, activity.id, receipt, store.defaultTenantId(), invalidOutcome,
    ), 'invalid')
    assert.equal(store.getToolActivity(session.id, activity.id)?.status, 'running', 'invalid settlement must not mutate the receipt')
    assert.equal(store.listAuditLog(store.defaultTenantId()).length, auditCountBeforeInvalidSettlement,
      'invalid settlement must not append an audit outcome')
  }
  assert.equal(store.settleMcpToolActivityExecution(session.id, activity.id, receipt, store.defaultTenantId(), {
    status: 'failed', summary: 'Contradictory', result,
  }), 'invalid', 'a successful result cannot be persisted as a returned tool error')
  assert.equal(store.settleMcpToolActivityExecution(session.id, activity.id, receipt, store.defaultTenantId(), {
    status: 'done', summary: 'Malformed', result: { resultType: 'complete', content: [{ type: 'text' }], isError: false } as never,
  }), 'invalid', 'malformed remote content cannot enter durable Session truth')
  const settled = store.settleMcpToolActivityExecution(session.id, activity.id, receipt, store.defaultTenantId(), {
    status: 'done', summary: 'Completed', result,
  })
  assert.equal(typeof settled, 'object')
  assert.deepEqual(settled && settled !== 'invalid' ? settled.mcpResult : undefined, result)
  assert.equal(store.settleMcpToolActivityExecution(session.id, activity.id, receipt, store.defaultTenantId(), {
    status: 'done', summary: 'Again', result,
  }), 'invalid', 'a late worker cannot settle twice')
  assert.equal(store.listAuditLog(store.defaultTenantId())[0]?.outcome, 'fulfilled')

  for (let index = 0; index < 6; index += 1) {
    store.appendMessage(session.id, { id: store.mintMessageId('user'), role: 'user', content: `Later terminal turn ${index}` })
  }
  const plan = store.prepareSessionCompaction(session.id)
  assert.ok(plan && plan.kind === 'ready')
  store.applySessionCompaction(plan, 'The external MCP call completed with an accepted result.')
  assert.equal(store.getToolActivity(session.id, activity.id), undefined, 'archived history is not a new execution door')
  const archived = store.getSession(session.id)?.compactedMessages
    ?.flatMap((message) => message.toolActivities ?? [])
    .find((candidate) => candidate.id === activity.id)
  assert.ok(archived)
  archived.status = 'running'
  assert.equal(store.getToolActivityDecision(session.id, activity.id, receipt, store.defaultTenantId(), 'confirm'), 'invalid',
    'even a malformed archived running receipt cannot acknowledge or reacquire execution')
  assert.equal(store.beginMcpToolActivityExecution(session.id, activity.id, receipt, store.defaultTenantId()), 'invalid')
  archived.status = 'done'
  assert.equal(store.getToolActivityDecision(session.id, activity.id, receipt, store.defaultTenantId(), 'confirm')?.decisionId, receipt,
    'the exact archived terminal receipt remains replayable')
  store.appendMessage(session.id, {
    id: store.mintMessageId('assistant'), role: 'assistant', content: 'A later ambiguous proposal.',
    toolActivities: [{ ...activity, status: 'proposed', summary: 'Changed arguments', input: { text: 'changed' }, decisionId: undefined, mcpResult: undefined }],
  })
  assert.equal(store.getToolActivityDecision(session.id, activity.id, receipt, store.defaultTenantId(), 'confirm')?.decisionId, receipt,
    'the exact archived receipt wins over a later model-authored activity that reuses its id')
  const freshReceipt = `tool-activity-decision-${'3'.repeat(24)}`
  assert.equal(store.getToolActivityDecision(session.id, activity.id, freshReceipt, store.defaultTenantId(), 'confirm'), 'invalid')
  assert.equal(store.beginMcpToolActivityExecution(session.id, activity.id, freshReceipt, store.defaultTenantId()), 'invalid',
    'an ambiguous reused activity id cannot authorize the changed arguments')

  const activeCollision = store.createSession(`mcp duplicate active ids ${Date.now()}`)
  const duplicateId = `mcp-duplicate-active-${Date.now()}`
  for (const value of ['first', 'second']) {
    store.appendMessage(activeCollision.id, {
      id: store.mintMessageId('assistant'), role: 'assistant', content: `Proposal ${value}.`,
      toolActivities: [{ ...activity, id: duplicateId, status: 'proposed', input: { text: value }, decisionId: undefined, mcpResult: undefined }],
    })
  }
  assert.equal(store.getToolActivityDecision(activeCollision.id, duplicateId, freshReceipt, store.defaultTenantId(), 'confirm'), 'invalid')
  assert.equal(store.beginMcpToolActivityExecution(activeCollision.id, duplicateId, freshReceipt, store.defaultTenantId()), 'invalid',
    'two active rows sharing a model-authored id cannot select one set of arguments')

  const settlementCollision = store.createSession(`mcp settlement collision ${Date.now()}`)
  const settlementId = `mcp-settlement-collision-${Date.now()}`
  const settlementReceipt = `tool-activity-decision-${'4'.repeat(24)}`
  store.appendMessage(settlementCollision.id, {
    id: store.mintMessageId('assistant'), role: 'assistant', content: 'Original proposal.',
    toolActivities: [{ ...activity, id: settlementId, status: 'proposed', decisionId: undefined, mcpResult: undefined }],
  })
  const collisionRunning = store.beginMcpToolActivityExecution(
    settlementCollision.id, settlementId, settlementReceipt, store.defaultTenantId(),
  )
  assert.equal(typeof collisionRunning === 'object' ? collisionRunning.status : collisionRunning, 'running')
  store.appendMessage(settlementCollision.id, {
    id: store.mintMessageId('assistant'), role: 'assistant', content: 'Colliding later proposal.',
    toolActivities: [{ ...activity, id: settlementId, status: 'proposed', input: { text: 'later' }, decisionId: undefined, mcpResult: undefined }],
  })
  const collisionSettled = store.settleMcpToolActivityExecution(
    settlementCollision.id, settlementId, settlementReceipt, store.defaultTenantId(),
    { status: 'done', summary: 'Original call completed', result },
  )
  assert.equal(typeof collisionSettled === 'object' ? collisionSettled.status : collisionSettled, 'done',
    'a later duplicate id cannot strand settlement of the exact running receipt')
})

test('only a currently executable external MCP connection can be newly attached', () => {
  const tenantId = store.defaultTenantId()
  const connectionId = 'mcp-connection-12121212121212121212121212121212'
  const tool = { name: 'write', inputSchema: { type: 'object' } }
  const context = { id: connectionId, type: 'mcp' as const, label: 'Reviewed MCP', scope: '*' }
  const beforeInspection = store.createSession(`mcp unavailable attach ${Date.now()}`)
  store.createMcpConnection({ id: connectionId, label: 'Reviewed MCP', endpoint: 'https://8.8.8.8/mcp', authentication: 'none' }, tenantId)
  assert.throws(() => store.attachContext(beforeInspection.id, context), ValidationError)
  assert.deepEqual(store.sessionContexts(beforeInspection.id), [])

  store.commitMcpInspection(connectionId, tenantId, 0, {
    protocolVersion: MCP_MODERN_VERSION, cleanup: 'not-needed', tools: [tool],
    schemaAdmission: { version: MCP_SCHEMA_ADMISSION_VERSION, hashes: [mcpToolSchemaHash(tool)] },
  }, 1)
  store.attachContext(beforeInspection.id, context)
  assert.deepEqual(store.sessionContexts(beforeInspection.id), [context])
  assert.match(store.connectorDetail(context, tenantId).access[0]!, /explicit approval before every call/i)

  store.disconnectMcpConnection(connectionId, tenantId, 1)
  store.attachContext(beforeInspection.id, context)
  assert.deepEqual(store.sessionContexts(beforeInspection.id), [context], 'a disconnected saved chip remains for honest recovery')
  assert.match(store.connectorDetail(context, tenantId).access[0]!, /unavailable until.*inspected/i)

  const afterDisconnect = store.createSession(`mcp disconnected attach ${Date.now()}`)
  assert.throws(() => store.attachContext(afterDisconnect.id, context), ValidationError)
  assert.throws(() => store.updateSessionContextState(afterDisconnect.id, [{ action: 'attach', context }], { mode: 'none' }), ValidationError)
  assert.deepEqual(store.sessionContexts(afterDisconnect.id), [])
})

test('unresolved external MCP transcript state cannot be erased, summarized, or copied as a counterfeit receipt', () => {
  const tenantId = store.defaultTenantId()
  const proposal = (id: string): ToolActivity => ({
    id, tool: 'mcp__saved__write', connector: 'Saved MCP',
    connectorId: 'mcp-connection-cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd', kind: 'action', status: 'proposed',
    summary: 'Proposed', input: { text: id },
    mcp: { connectionRevision: 1, toolName: 'write', schemaHash: 'b'.repeat(64) },
  })

  const pending = store.createSession(`mcp pending transcript ${Date.now()}`)
  const before = { id: store.mintMessageId('user'), role: 'user' as const, content: 'Earlier safe turn.' }
  store.appendMessage(pending.id, before)
  const pendingMessageId = store.mintMessageId('assistant')
  store.appendMessage(pending.id, {
    id: pendingMessageId, role: 'assistant', content: 'Review this call.',
    toolActivities: [proposal('mcp-pending-transcript')],
  })
  for (let index = 0; index < 6; index += 1) {
    store.appendMessage(pending.id, { id: store.mintMessageId('user'), role: 'user', content: `Later turn ${index}` })
  }
  assert.throws(() => store.prepareSessionCompaction(pending.id), (error: unknown) =>
    error instanceof ConflictError && /MCP tool request/i.test(error.message))
  assert.throws(() => store.forkSession(pending.id, pendingMessageId, tenantId), (error: unknown) =>
    error instanceof ConflictError && /MCP tool request/i.test(error.message))
  assert.ok(store.forkSession(pending.id, before.id, tenantId), 'a cut before the unresolved request remains forkable')

  const raced = store.createSession(`mcp compaction race ${Date.now()}`)
  for (let index = 0; index < 7; index += 1) {
    store.appendMessage(raced.id, { id: store.mintMessageId('user'), role: 'user', content: `Stable turn ${index}` })
  }
  const plan = store.prepareSessionCompaction(raced.id)
  assert.ok(plan && plan.kind === 'ready')
  store.appendMessage(raced.id, {
    id: store.mintMessageId('assistant'), role: 'assistant', content: 'New request.',
    toolActivities: [proposal('mcp-after-compaction-plan')],
  })
  assert.throws(() => store.applySessionCompaction(plan, 'Stale summary'), (error: unknown) =>
    error instanceof ConflictError && /MCP tool request/i.test(error.message))

  const running = store.createSession(`mcp running transcript ${Date.now()}`)
  const activity = proposal('mcp-running-transcript')
  store.appendMessage(running.id, {
    id: store.mintMessageId('assistant'), role: 'assistant', content: 'Approved request.', toolActivities: [activity],
  })
  const receipt = `tool-activity-decision-${'2'.repeat(24)}`
  assert.equal(store.beginMcpToolActivityExecution(running.id, activity.id, receipt, tenantId)?.status, 'running')
  assert.throws(() => store.removeSession(running.id), (error: unknown) =>
    error instanceof ConflictError && /running MCP tool/i.test(error.message))
  assert.equal(store.getToolActivity(running.id, activity.id)?.decisionId, receipt, 'the exact durable receipt remains')
  assert.notEqual(store.settleMcpToolActivityExecution(running.id, activity.id, receipt, tenantId, {
    status: 'failed', summary: 'Known refusal before submission.',
  }), 'invalid')
  assert.equal(store.removeSession(running.id), true, 'terminal MCP history does not prevent reviewed deletion')
})
