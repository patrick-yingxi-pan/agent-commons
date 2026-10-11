/** Store locks for private person-bound MCP input authority and receipts. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { accounts } from '../accounts.ts'
import { MCP_MODERN_VERSION } from '../mcpProtocol.ts'
import { MCP_SCHEMA_ADMISSION_VERSION, mcpToolSchemaHash } from '../mcpToolAdmission.ts'
import { store } from './index.ts'

let sequence = 0
const tool = { name: 'submit.application', inputSchema: { type: 'object', properties: { query: { type: 'string' } },
  required: ['query'], additionalProperties: false } }
const schemaHash = mcpToolSchemaHash(tool)
const firstForm = { resultType: 'input_required', inputRequests: { details: { method: 'elicitation/create', params: {
  message: 'Choose an application.', requestedSchema: { type: 'object', properties: { choice: { type: 'string', enum: ['one', 'two'] } }, required: ['choice'] },
} } }, requestState: 'private-state-one' }
const secondForm = { resultType: 'input_required', inputRequests: { reference: { method: 'elicitation/create', params: {
  message: 'Confirm a reference.', requestedSchema: { type: 'object', properties: { reference: { type: 'string' } }, required: ['reference'] },
} } }, requestState: 'private-state-two' }
const cookieOf = (response: { headers: Record<string, string> }) => response.headers['set-cookie']?.split(';')[0] ?? ''

async function person(label: string) {
  const tag = `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${++sequence}`
  const response = await (await import('../testkit/http.ts')).call('POST', '/auth/signup', {
    name: label, email: `${tag}@mcp-input-store.example`, password: `${tag}-password`,
  })
  assert.equal(response.status, 200, JSON.stringify(response.json))
  return { userId: response.json.user.id as string, email: response.json.user.email as string, cookie: cookieOf(response) }
}

test('private input rounds bind to a live person, permit exact receipt recovery, and refuse revoked authority', async () => {
  const owner = await person('MCP Input Store Owner')
  const peer = await person('MCP Input Store Peer')
  const http = await import('../testkit/http.ts')
  const org = await http.call('POST', '/orgs', { name: `MCP input store ${sequence}` }, { cookie: owner.cookie })
  assert.equal(org.status, 201)
  const invite = await http.call('POST', `/orgs/${org.json.id}/invites`, { email: peer.email }, { cookie: owner.cookie })
  assert.equal(invite.status, 201)
  assert.equal((await http.call('POST', `/me/invites/${invite.json.id}/accept`, undefined, { cookie: peer.cookie })).status, 200)
  const tenantId = org.json.id as string
  assert.ok(accounts.identityFor(owner.userId, tenantId))
  assert.ok(accounts.identityFor(peer.userId, tenantId))

  const connectionId = `mcp-connection-${(++sequence).toString(16).padStart(32, '0')}`
  store.createMcpConnection({ id: connectionId, label: 'Private input', endpoint: 'https://forms.example.test/mcp', authentication: 'none' },
    tenantId, false, owner.userId)
  store.commitMcpInspection(connectionId, tenantId, 0, { protocolVersion: MCP_MODERN_VERSION, cleanup: 'not-needed', tools: [tool],
    schemaAdmission: { version: MCP_SCHEMA_ADMISSION_VERSION, hashes: [schemaHash] } }, Date.now(), undefined, undefined, owner.userId)
  const session = store.createSession(`MCP private input ${sequence}`, tenantId)
  store.attachContext(session.id, { id: connectionId, type: 'mcp', label: 'Private input', scope: '*' }, owner.userId)
  const activityId = `mcp-input-store-${sequence}`
  const decisionId = `tool-activity-decision-${(++sequence).toString(16).padStart(24, '0')}`
  const activity = { id: activityId, tool: 'mcp__form__submit', connector: 'Private input', connectorId: connectionId,
    kind: 'action' as const, status: 'proposed' as const, summary: 'Submit', input: { query: 'application' },
    mcp: { connectionRevision: 1, toolName: tool.name, schemaHash },
  }
  assert.ok(store.appendMessage(session.id, { id: store.mintMessageId('assistant'), role: 'assistant', content: 'Submit?',
    toolActivities: [activity] }, { actorUserId: owner.userId }))
  const running = store.beginMcpToolActivityExecution(session.id, activityId, decisionId, tenantId, owner.userId, true)
  assert.ok(running && running !== 'invalid')
  assert.equal(store.mcpInputExecutionPermitted(session.id, activityId, decisionId, tenantId, owner.userId), true)
  assert.equal(store.mcpInputExecutionPermitted(session.id, activityId, decisionId, tenantId, peer.userId), false,
    'same-tenant peer cannot borrow the running continuation authority')
  assert.ok(store.settleMcpToolActivityExecution(session.id, activityId, decisionId, tenantId,
    { status: 'awaiting-input', summary: 'Waiting for private input', pending: firstForm }, owner.userId, 0))
  const ownerReview = store.mcpInputReview(session.id, activityId, tenantId, owner.userId)
  assert.equal(ownerReview?.review?.round, 1)
  assert.deepEqual(ownerReview?.review?.inputRequests, firstForm.inputRequests)
  assert.equal(JSON.stringify(ownerReview).includes('private-state-one'), false)
  assert.equal(store.mcpInputReview(session.id, activityId, tenantId, peer.userId)?.review, null)
  assert.equal(store.mcpInputReview(session.id, activityId, tenantId, undefined)?.review, null,
    'tenant-only identity is not a person-owned form grant')

  const responseId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const command = { decisionId, round: 1, responseId, action: 'respond', responses: { details: { action: 'accept', content: { choice: 'one' } } } }
  const begun = store.beginMcpInputResponse(session.id, activityId, tenantId, owner.userId, command)
  assert.ok(begun && begun !== 'invalid' && begun.kind === 'execute')
  assert.equal(store.getToolActivity(session.id, activityId)?.status, 'running')
  const replay = store.beginMcpInputResponse(session.id, activityId, tenantId, owner.userId, command)
  assert.ok(replay && replay !== 'invalid' && replay.kind === 'receipt')
  assert.equal(replay.receipt.round, 1)
  assert.equal(replay.receipt.activity.status, 'running')
  const changedBody = store.beginMcpInputResponse(session.id, activityId, tenantId, owner.userId, {
    ...command, responses: { details: { action: 'accept', content: { choice: 'two' } } },
  })
  assert.equal(changedBody, 'invalid', 'the same response identity cannot be rebound to changed content')
  assert.equal(store.beginMcpInputResponse(session.id, activityId, tenantId, peer.userId, command), undefined)

  assert.ok(store.settleMcpToolActivityExecution(session.id, activityId, decisionId, tenantId,
    { status: 'awaiting-input', summary: 'Waiting again', pending: secondForm }, owner.userId, 1))
  const secondReview = store.mcpInputReview(session.id, activityId, tenantId, owner.userId)
  assert.equal(secondReview?.review?.round, 2)
  assert.equal(secondReview?.review?.canContinue, true)
  store.disconnectMcpConnection(connectionId, tenantId, 1, owner.userId)
  const disconnected = store.mcpInputReview(session.id, activityId, tenantId, owner.userId)
  assert.equal(disconnected?.review?.canContinue, false)
  assert.match(disconnected?.review?.refusal ?? '', /no follow-up/i)
  assert.equal(store.beginMcpInputResponse(session.id, activityId, tenantId, owner.userId, {
    decisionId, round: 2, responseId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', action: 'respond',
    responses: { reference: { action: 'accept', content: { reference: 'abc' } } },
  }), 'invalid', 'a changed live binding cannot authorize another answer')

  const expired = store.expireMcpInputReviews(Date.now() + 3_600_001)
  assert.ok(expired >= 1)
  assert.equal(store.getToolActivity(session.id, activityId)?.status, 'uncertain')
  assert.equal(store.mcpInputReview(session.id, activityId, tenantId, owner.userId)?.review, null)
  const knownReceipt = store.mcpInputReceipt(session.id, activityId, decisionId, responseId, tenantId, owner.userId)
  assert.equal(knownReceipt?.round, 1, 'expiry of the next wait does not erase an already settled answer receipt')
  for (let index = 0; index < 6; index++) store.appendMessage(session.id, {
    id: store.mintMessageId('user'), role: 'user', content: `Later turn ${index}`,
  })
  const compact = store.prepareSessionCompaction(session.id)
  assert.ok(compact && compact.kind === 'ready')
  store.applySessionCompaction(compact, 'A privately reviewed MCP call was stopped after its input review expired.')
  assert.equal(store.getToolActivity(session.id, activityId), undefined)
  assert.equal(store.mcpInputReview(session.id, activityId, tenantId, owner.userId, decisionId)?.activity.status, 'uncertain',
    'fresh review recovery can retire an archived terminal attempt')
  const archivedReplay = store.beginMcpInputResponse(session.id, activityId, tenantId, owner.userId, command)
  assert.ok(archivedReplay && archivedReplay !== 'invalid' && archivedReplay.kind === 'receipt')
  store.appendMessage(session.id, { id: store.mintMessageId('assistant'), role: 'assistant', content: 'Another proposal.',
    toolActivities: [{ ...activity, status: 'proposed', decisionId: undefined }] }, { actorUserId: owner.userId })
  assert.equal(store.mcpInputReview(session.id, activityId, tenantId, owner.userId, decisionId)?.activity.status, 'uncertain',
    'a reused live activity id cannot redirect exact archived review recovery')

  async function newWaitingFlow(suffix: string) {
    const id = `mcp-connection-${(++sequence).toString(16).padStart(32, '0')}`
    store.createMcpConnection({ id, label: `Private input ${suffix}`, endpoint: 'https://forms.example.test/mcp', authentication: 'none' },
      tenantId, false, owner.userId)
    store.commitMcpInspection(id, tenantId, 0, { protocolVersion: MCP_MODERN_VERSION, cleanup: 'not-needed', tools: [tool],
      schemaAdmission: { version: MCP_SCHEMA_ADMISSION_VERSION, hashes: [schemaHash] } }, Date.now(), undefined, undefined, owner.userId)
    const target = store.createSession(`MCP ${suffix} ${sequence}`, tenantId)
    store.attachContext(target.id, { id, type: 'mcp', label: `Private input ${suffix}`, scope: '*' }, owner.userId)
    const rowId = `mcp-input-${suffix}-${sequence}`
    const row = { id: rowId, tool: 'mcp__form__submit', connector: `Private input ${suffix}`, connectorId: id,
      kind: 'action' as const, status: 'proposed' as const, summary: 'Submit', input: { query: 'application' },
      mcp: { connectionRevision: 1, toolName: tool.name, schemaHash },
    }
    assert.ok(store.appendMessage(target.id, { id: store.mintMessageId('assistant'), role: 'assistant', content: `Review ${suffix}?`,
      toolActivities: [row] }, { actorUserId: owner.userId }))
    const receiptId = `tool-activity-decision-${(++sequence).toString(16).padStart(24, '0')}`
    const first = store.beginMcpToolActivityExecution(target.id, rowId, receiptId, tenantId, owner.userId, true)
    assert.ok(first && first !== 'invalid' && first.status === 'running')
    assert.ok(store.settleMcpToolActivityExecution(target.id, rowId, receiptId, tenantId,
      { status: 'awaiting-input', summary: 'Waiting for private input', pending: firstForm }, owner.userId, 0))
    return { sessionId: target.id, activityId: rowId, decisionId: receiptId, connectionId: id }
  }

  const capFlow = await newWaitingFlow('round-cap')
  for (let round = 1; round <= 4; round++) {
    const responseId = `00000000-0000-4000-8000-${round.toString(16).padStart(12, '0')}`
    const response = store.beginMcpInputResponse(capFlow.sessionId, capFlow.activityId, tenantId, owner.userId, {
      decisionId: capFlow.decisionId, round, responseId, action: 'respond',
      responses: { details: { action: 'accept', content: { choice: 'one' } } },
    })
    assert.ok(response && response !== 'invalid' && response.kind === 'execute')
    const settled = store.settleMcpToolActivityExecution(capFlow.sessionId, capFlow.activityId, capFlow.decisionId, tenantId,
      { status: 'awaiting-input', summary: 'Another request', pending: firstForm }, owner.userId, round)
    assert.ok(settled && settled !== 'invalid')
    if (round < 4) assert.equal(settled.status, 'awaiting-input')
    else {
      assert.equal(settled.status, 'uncertain', 'the host refuses a fifth form round after the bounded four-round limit')
      assert.match(settled.summary, /limit/i)
    }
  }
  assert.equal(store.mcpInputReview(capFlow.sessionId, capFlow.activityId, tenantId, owner.userId, capFlow.decisionId)?.review, null)
  assert.equal(store.mcpInputExecutionPermitted(capFlow.sessionId, capFlow.activityId, capFlow.decisionId, tenantId, owner.userId), false)

  const revokedFlow = await newWaitingFlow('revoked-actor')
  const membershipsBeforeRevocation = accounts.memberships.slice()
  try {
    accounts.memberships = accounts.memberships.filter(row => !(row.userId === owner.userId && row.tenantId === tenantId))
    assert.equal(accounts.identityFor(owner.userId, tenantId), null)
    assert.equal(store.mcpInputReview(revokedFlow.sessionId, revokedFlow.activityId, tenantId, owner.userId, revokedFlow.decisionId)?.review, null)
    assert.equal(store.beginMcpInputResponse(revokedFlow.sessionId, revokedFlow.activityId, tenantId, owner.userId, {
      decisionId: revokedFlow.decisionId, round: 1, responseId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', action: 'stop',
    }), undefined, 'a stale owner cannot submit or Stop after losing their actual org membership')
    assert.equal(store.expireMcpInputReviews(Date.now()), 1,
      'the housekeeping authority check retires a waiting form when its actual person loses membership')
    assert.equal(store.getToolActivity(revokedFlow.sessionId, revokedFlow.activityId)?.status, 'uncertain')
    assert.equal(store.mcpInputReceipt(revokedFlow.sessionId, revokedFlow.activityId, revokedFlow.decisionId,
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', tenantId, owner.userId), undefined,
    'a stale person cannot recover an answer receipt after membership loss')
  } finally {
    accounts.memberships = membershipsBeforeRevocation
  }
})
