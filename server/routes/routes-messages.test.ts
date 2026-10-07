/** Integration tests for the message route (POST /sessions/:id/messages) — it must
 *  stream the reply, emit the tool-driven proposals (`message.relations` /
 *  `message.escalation`), and honor `ephemeral` by NOT persisting the turn.
 *  Boots the mock model on an ephemeral port and points the backend at it. */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type { Server } from 'node:http'
import { startModelServer } from '../model/index.ts'
import { store } from '../store/index.ts'
import { call, callRaw } from '../testkit/http.ts'
import { toolActivityDecisionId } from '../toolActivityDecisionIdentity.ts'

let server: Server
before(async () => {
  server = startModelServer(0, '127.0.0.1')
  await new Promise<void>((r) => server.on('listening', () => r()))
  const addr = server.address()
  const port = typeof addr === 'object' && addr ? addr.port : 0
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${port}`
})
after(() => {
  delete process.env.ANTHROPIC_BASE_URL
  server.close()
})

const PROJECT_MSG = 'Create a project called Auth hardening.'
const SAVE_MSG = 'Save the recap of this as launch-recap.md'

test('a project turn streams start → escalation → end over SSE', async () => {
  const { status, body } = await callRaw('POST', '/sessions/auth-refactor/messages', { text: PROJECT_MSG, ephemeral: true })
  assert.equal(status, 200)
  assert.match(body, /"type":"message\.start"/)
  assert.match(body, /"type":"message\.escalation"/)
  assert.match(body, /"kind":"project"/)
  assert.match(body, /"type":"message\.end"/)
})

test('a relation-op turn emits message.relations with the proposed op', async () => {
  const { body } = await callRaw('POST', '/sessions/auth-refactor/messages', { text: SAVE_MSG, ephemeral: true })
  assert.match(body, /"type":"message\.relations"/)
  assert.match(body, /"kind":"save-artifact"/)
})

test('Project prose proposals freeze the live resolved field before delayed consent', async () => {
  const stamp = Date.now().toString(36)
  const projectId = `p-model-prose-${stamp}`
  const projectName = `Model prose ${stamp}`
  store.applyRelationOp({
    kind: 'create-project',
    projectId,
    projectName,
    projectDescription: 'Current public copy',
  })
  store.applyRelationOp({
    kind: 'set-project-instructions',
    projectId,
    projectName,
    instructions: 'Current private guidance',
  })
  const session = store.createSession('model prose precondition')

  const description = await callRaw('POST', `/sessions/${session.id}/messages`, {
    text: `Update the description for ${projectName} saying "Proposed public copy".`,
    ephemeral: true,
  })
  assert.match(description.body, /"kind":"set-project-description"/)
  assert.match(description.body, /"expectedDescription":"Current public copy"/)

  const instructions = await callRaw('POST', `/sessions/${session.id}/messages`, {
    text: `Set project instructions for ${projectName}: Proposed private guidance`,
    ephemeral: true,
  })
  assert.match(instructions.body, /"kind":"set-project-instructions"/)
  assert.match(instructions.body, /"expectedInstructions":"Current private guidance"/)
})

test('ephemeral turns do not persist — message count is unchanged', async () => {
  const before = (await call('GET', '/sessions/auth-refactor')).json.messages?.length ?? 0
  await callRaw('POST', '/sessions/auth-refactor/messages', { text: PROJECT_MSG, ephemeral: true })
  const after = (await call('GET', '/sessions/auth-refactor')).json.messages?.length ?? 0
  assert.equal(after, before)
})

test('an attached connector’s tools reach the model — a naming message drives a message.toolActivity round-trip (P6)', async () => {
  const s = store.createSession('connector round-trip')
  // Attach a Slack connector context — the backend derives its tools and declares them.
  store.attachContext(s.id, { id: 'conn-slack', type: 'connector', label: 'Slack', scope: '*' })
  const { status, body } = await callRaw('POST', `/sessions/${s.id}/messages`, { text: 'list my slack channels', ephemeral: true })
  assert.equal(status, 200)
  // The model called the derived connector tool; the backend executed it and streamed
  // the activity + fed the (fixture) result back for the final prose.
  assert.match(body, /"type":"message\.toolActivity"/, 'the tool-activity event is emitted')
  assert.match(body, /connector__slack__list/, 'the derived connector tool was the one called')
  assert.match(body, /#launch/, 'the fixture result rode back in the activity')
  assert.match(body, /"type":"message\.end"/)
})

test('with no connector attached, a naming message drives no tool activity (authority is structural)', async () => {
  const s = store.createSession('no connector attached')
  const { body } = await callRaw('POST', `/sessions/${s.id}/messages`, { text: 'list my slack channels', ephemeral: true })
  assert.doesNotMatch(body, /"type":"message\.toolActivity"/, 'no attached connector ⇒ no derived tool ⇒ nothing to call')
})

test('a multi-tool MCP server selects the RIGHT tool + kind over the wire (write → write_file/action, only PROPOSED)', async () => {
  const s = store.createSession('mcp multi-tool')
  store.attachContext(s.id, { id: 'mcp-fs', type: 'mcp', label: 'MCP · filesystem', scope: '*' })
  const { body } = await callRaw('POST', `/sessions/${s.id}/messages`, { text: 'write a file via filesystem', ephemeral: true })
  assert.match(body, /mcp__filesystem__write_file/, 'a write message selects write_file, not the first-declared read_file')
  assert.match(body, /"kind":"action"/, 'a write is classified as an action, not a no-consent read')
  assert.match(body, /"status":"proposed"/, 'a write is only PROPOSED — consent-gated, not executed on the turn')
  assert.doesNotMatch(body, /mcp__filesystem__read_file/, 'read_file was not the one called')
  assert.match(body, /used the connected tools/i, 'the second-turn prose references the connector activity')
})

test('confirming a proposed connector action executes it (mock) + records an audit entry', async () => {
  const s = store.createSession('connector write confirm')
  store.attachContext(s.id, { id: 'mcp-fs', type: 'mcp', label: 'MCP · filesystem', scope: '*' })
  // A persisted (non-ephemeral) turn so the proposed activity lives on a real message.
  await callRaw('POST', `/sessions/${s.id}/messages`, { text: 'write a file via filesystem' })
  const thread = (await call('GET', `/sessions/${s.id}`)).json.messages ?? []
  const proposed = thread
    .flatMap((m: { toolActivities?: { id: string; status?: string; kind?: string }[] }) => m.toolActivities ?? [])
    .find((a: { status?: string; kind?: string }) => a.kind === 'action' && a.status === 'proposed')
  assert.ok(proposed, 'the write landed as a proposed action awaiting consent')

  const auditBefore = store.listAuditLog().filter((e) => e.capability === 'connector.write').length
  const key = `connector-confirm-${s.id}`
  const headers = { 'idempotency-key': key }
  const res = await call('POST', `/sessions/${s.id}/tool-activities/${proposed.id}`, { decision: 'confirm' }, headers)
  assert.equal(res.status, 200)
  assert.equal(res.json.status, 'done', 'confirm flips the action to done')
  assert.equal(
    res.json.decisionId,
    toolActivityDecisionId(store.defaultTenantId(), s.id, proposed.id, key),
    'the terminal activity carries the exact durable decision receipt',
  )
  assert.match(res.json.summary, /\(mock\)/, 'the done summary is the mock result')
  const auditAfter = store.listAuditLog().filter((e) => e.capability === 'connector.write').length
  assert.equal(auditAfter, auditBefore + 1, 'confirm records exactly one connector.write audit entry')

  // Idempotent: confirming again returns the already-done activity, no second audit.
  const again = await call('POST', `/sessions/${s.id}/tool-activities/${proposed.id}`, { decision: 'confirm' }, headers)
  assert.equal(again.json.status, 'done')
  assert.equal(again.json.decisionId, res.json.decisionId, 'same-key Retry returns the durable receipt')
  assert.equal(store.listAuditLog().filter((e) => e.capability === 'connector.write').length, auditAfter, 'no duplicate audit on re-confirm')

  const opposite = await call('POST', `/sessions/${s.id}/tool-activities/${proposed.id}`, { decision: 'decline' }, headers)
  assert.equal(opposite.status, 400, 'one logical key cannot acknowledge the opposite decision')
  const redirected = await call(
    'POST',
    `/sessions/${s.id}/tool-activities/${proposed.id}`,
    { decision: 'confirm' },
    { 'idempotency-key': `${key}-changed` },
  )
  assert.equal(redirected.status, 400, 'a terminal activity cannot be claimed by a different receipt')
})

test('release posture refuses connector confirmation without claiming an external effect', async () => {
  const s = store.createSession('connector release refusal')
  store.attachContext(s.id, { id: 'mcp-fs', type: 'mcp', label: 'MCP · filesystem', scope: '*' })
  await callRaw('POST', `/sessions/${s.id}/messages`, { text: 'write a file via filesystem' })
  const thread = (await call('GET', `/sessions/${s.id}`)).json.messages ?? []
  const proposed = thread
    .flatMap((m: { toolActivities?: { id: string; status?: string; kind?: string }[] }) => m.toolActivities ?? [])
    .find((a: { status?: string; kind?: string }) => a.kind === 'action' && a.status === 'proposed')
  assert.ok(proposed)

  const prior = process.env.CONNECTOR_RUNTIME
  process.env.CONNECTOR_RUNTIME = 'unconfigured'
  try {
    const auditBefore = store.listAuditLog().filter((e) => e.capability === 'connector.write' && e.outcome === 'denied').length
    const res = await call('POST', `/sessions/${s.id}/tool-activities/${proposed.id}`, { decision: 'confirm' })
    assert.equal(res.status, 409)
    assert.match(res.json.error.message, /not configured/i)
    assert.equal(store.getToolActivity(s.id, proposed.id)?.status, 'proposed', 'retry and decline remain open')
    const auditAfter = store.listAuditLog().filter((e) => e.capability === 'connector.write' && e.outcome === 'denied').length
    assert.equal(auditAfter, auditBefore + 1, 'the refused external attempt is detective-audited')
  } finally {
    if (prior === undefined) delete process.env.CONNECTOR_RUNTIME
    else process.env.CONNECTOR_RUNTIME = prior
  }
})

test('declining a proposed connector action marks it declined + records no audit', async () => {
  const s = store.createSession('connector write decline')
  store.attachContext(s.id, { id: 'mcp-fs', type: 'mcp', label: 'MCP · filesystem', scope: '*' })
  await callRaw('POST', `/sessions/${s.id}/messages`, { text: 'write a file via filesystem' })
  const thread = (await call('GET', `/sessions/${s.id}`)).json.messages ?? []
  const proposed = thread
    .flatMap((m: { toolActivities?: { id: string; status?: string; kind?: string }[] }) => m.toolActivities ?? [])
    .find((a: { status?: string; kind?: string }) => a.kind === 'action' && a.status === 'proposed')
  const before = store.listAuditLog().filter((e) => e.capability === 'connector.write').length
  const res = await call('POST', `/sessions/${s.id}/tool-activities/${proposed.id}`, { decision: 'decline' })
  assert.equal(res.json.status, 'declined', 'decline marks it declined')
  assert.equal(store.listAuditLog().filter((e) => e.capability === 'connector.write').length, before, 'a declined action records no audit')
})

test('a durable running external MCP receipt replays without dispatch and a different receipt is refused', async () => {
  const s = store.createSession('external MCP running replay')
  const activityId = `external-running-${Date.now()}`
  const key = `external-running-key-${Date.now()}`
  store.appendMessage(s.id, {
    id: store.mintMessageId('assistant'), role: 'assistant', content: 'Awaiting the external result.',
    toolActivities: [{
      id: activityId, tool: 'mcp__saved__write', connector: 'Saved MCP',
      connectorId: 'mcp-connection-cccccccccccccccccccccccccccccccc', kind: 'action', status: 'proposed',
      summary: 'Proposed', input: { value: 'exact' },
      mcp: { connectionRevision: 1, toolName: 'write', schemaHash: 'c'.repeat(64) },
    }],
  })
  const receipt = toolActivityDecisionId(store.defaultTenantId(), s.id, activityId, key)
  const running = store.beginMcpToolActivityExecution(s.id, activityId, receipt, store.defaultTenantId())
  assert.equal(typeof running, 'object')

  const replay = await call('POST', `/sessions/${s.id}/tool-activities/${activityId}`, { decision: 'confirm' }, { 'idempotency-key': key })
  assert.equal(replay.status, 200)
  assert.equal(replay.json.status, 'running')
  assert.equal(replay.json.decisionId, receipt)

  const redirected = await call('POST', `/sessions/${s.id}/tool-activities/${activityId}`, { decision: 'confirm' }, { 'idempotency-key': `${key}-other` })
  assert.equal(redirected.status, 400)
  assert.equal(store.getToolActivity(s.id, activityId)?.status, 'running')
})

test('an attached connector the message does NOT name drives no tool activity', async () => {
  const s = store.createSession('connector attached but unnamed')
  store.attachContext(s.id, { id: 'conn-slack', type: 'connector', label: 'Slack', scope: '*' })
  const { body } = await callRaw('POST', `/sessions/${s.id}/messages`, { text: 'what should we ship next quarter?', ephemeral: true })
  assert.doesNotMatch(body, /"type":"message\.toolActivity"/, 'naming no connector ⇒ no call, even with one attached')
})

test('a non-ephemeral connector turn persists its toolActivities (survives reload)', async () => {
  const s = store.createSession('connector persistence')
  store.attachContext(s.id, { id: 'conn-slack', type: 'connector', label: 'Slack', scope: '*' })
  await callRaw('POST', `/sessions/${s.id}/messages`, { text: 'list my slack channels' }) // not ephemeral → persisted
  const thread = (await call('GET', `/sessions/${s.id}`)).json.messages ?? []
  const assistant = thread.find((m: { role: string; toolActivities?: unknown[] }) => m.role === 'assistant' && (m.toolActivities?.length ?? 0) > 0)
  assert.ok(assistant, 'the persisted assistant turn carries its toolActivities')
  assert.equal(assistant.toolActivities[0].tool, 'connector__slack__list')
})

test('a persisted assistant turn is stamped with its driving Agent (D16 per-turn provenance)', async () => {
  const s = store.createSession('start')
  await callRaw('POST', `/sessions/${s.id}/messages`, { text: 'hello' }) // not ephemeral → persisted
  const thread = (await call('GET', `/sessions/${s.id}`)).json.messages ?? []
  const assistant = thread.find((m: { role: string; agentId?: string }) => m.role === 'assistant')
  assert.ok(assistant, 'the assistant turn was persisted')
  assert.equal(assistant.agentId, 'agent-default') // the default driver
})

test('a completed turn counts an `ok` generation outcome (route → /metrics wiring, F6 PD31)', async () => {
  const before = store.generationOutcomes().ok
  const tenant = `tenant-generation-outcome-${Date.now().toString(36)}`
  const s = store.createSession('outcome wiring', tenant)
  const { status, body } = await callRaw('POST', `/sessions/${s.id}/messages`, { text: 'hello', ephemeral: true }, { 'x-tenant-id': tenant })
  assert.equal(status, 200)
  assert.match(body, /"type":"message\.end"/)
  assert.equal(store.generationOutcomes().ok, before + 1, 'the route records the turn outcome the model reported')
})
