import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { RoutineMcpApprovalIntent } from '../../contract/routineMcp.ts'
import type { RoutineMcpReview } from '../../contract/routineMcpApi.ts'
import { MCP_SCHEMA_ADMISSION_VERSION, mcpToolSchemaHash } from '../mcpToolAdmission.ts'
import { MCP_MODERN_VERSION } from '../mcpProtocol.ts'
import { store } from '../store/index.ts'
import { call } from '../testkit/http.ts'
import { toolNameFor } from '../apiSurface.ts'
import { buildRouter } from './index.ts'

const owner = 'tenant-personal'
const audience = 'tenant-beta'
const tool = {
  name: 'search',
  inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false },
}
let sequence = 0

function provision() {
  const source = store.listSchedules(owner)[0]!
  const { id: _id, tenantId: _tenantId, ...seed } = structuredClone(source)
  const task = store.addSchedule({ ...seed, tenantId: owner, name: `Route Routine MCP ${Date.now()} ${++sequence}`,
    runs: [], enabled: false, steps: [], delivery: { tool: { id: 'assistant', label: 'Assistant', tone: 'claude' }, target: 'Run conversation' } })
  const connectionId = `mcp-connection-${Date.now().toString(16).padStart(32, '0').slice(-32)}`
  const schemaHash = mcpToolSchemaHash(tool)
  store.createMcpConnection({ id: connectionId, label: 'Reviewed search', endpoint: 'https://8.8.8.8/mcp', authentication: 'none' }, owner)
  store.commitMcpInspection(connectionId, owner, 0, {
    protocolVersion: MCP_MODERN_VERSION, cleanup: 'not-needed', tools: [tool],
    schemaAdmission: { version: MCP_SCHEMA_ADMISSION_VERSION, hashes: [schemaHash] },
  }, Date.now())
  const headers = { 'x-tenant-id': owner }
  const path = `/schedules/${task.id}/mcp-permission`
  const review = async (tenant = owner) => call('GET', path, undefined, { 'x-tenant-id': tenant })
  const intent = (current: RoutineMcpReview): RoutineMcpApprovalIntent => ({
    expectedRevision: current.policy.revision,
    expectedDefinitionRevision: current.definitionRevision,
    reviewHash: current.reviewHash,
    expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    maxCallsPerRun: 2,
    tools: [{ connectionId, connectionRevision: 1, toolName: tool.name, schemaHash, fixedArguments: { query: 'approved' } }],
  })
  const decision = (body: unknown, extraHeaders: Record<string, string> = headers) => call('POST', path, body, extraHeaders)
  const cleanup = () => {
    try { store.removeSchedule(task.id) } catch {}
    try { store.removeMcpConnection(connectionId, owner, 1) } catch {}
  }
  return { task, connectionId, schemaHash, path, headers, review, intent, decision, cleanup }
}

test('Routine MCP review is owner-only; shared readers and foreign tenants get the same 404', async () => {
  const f = provision()
  try {
    const grant = store.createGrant({ subject: { kind: 'schedule', id: f.task.id }, audience: { kind: 'org', orgId: audience }, tier: 'view' }, owner)
    assert.ok(grant && typeof grant === 'object')
    const own = await f.review()
    assert.equal(own.status, 200)
    assert.equal(own.json.routineId, f.task.id)
    assert.equal((await f.review(audience)).status, 404, 'ordinary schedule sharing does not expose the private review')
    assert.equal((await f.review('tenant-harbor')).status, 404)

    const foreignMalformed = await f.decision({ notARequest: true }, { 'x-tenant-id': audience })
    assert.equal(foreignMalformed.status, 404, 'existence is hidden before request-body validation')
    const missingMalformed = await call('POST', '/schedules/no-such-routine/mcp-permission', { bad: true }, { 'x-tenant-id': owner })
    assert.equal(missingMalformed.status, 404)
    store.revokeGrant(grant.id, owner)
  } finally { f.cleanup() }
})

test('approval and revoke requests are strict and replies carry exact request and decision identities', async () => {
  const f = provision()
  try {
    const current = (await f.review()).json as RoutineMcpReview
    const approval = f.intent(current)
    assert.equal((await f.decision({ requestId: 'bad-key', action: 'approve', approval, extra: true })).status, 400)
    assert.equal((await f.decision({ requestId: 'bad-fixed', action: 'approve', approval: {
      ...approval, tools: [{ ...approval.tools[0]!, fixedArguments: [] }],
    } })).status, 400)

    const requestId = `route-approve-${++sequence}`
    const approved = await f.decision({ requestId, action: 'approve', approval })
    assert.equal(approved.status, 200)
    assert.equal(approved.json.requestId, requestId)
    assert.ok(typeof approved.json.decisionId === 'string' && approved.json.decisionId.length > 0)
    assert.equal(approved.json.review.policy.approval.reviewHash, current.reviewHash)

    const revision = approved.json.review.policy.revision
    const revokeId = `route-revoke-${++sequence}`
    const revoked = await f.decision({ requestId: revokeId, action: 'revoke', expectedRevision: revision })
    assert.equal(revoked.status, 200)
    assert.equal(revoked.json.requestId, revokeId)
    assert.equal(revoked.json.review.policy.approval, null)
  } finally { f.cleanup() }
})

test('exact approval replay reflects current revocation; a changed payload under its key conflicts', async () => {
  const f = provision()
  try {
    const current = (await f.review()).json as RoutineMcpReview
    const request = { requestId: `approval-replay-${++sequence}`, action: 'approve', approval: f.intent(current) }
    const first = await f.decision(request)
    assert.equal(first.status, 200)
    const revoked = await f.decision({ requestId: `revoke-replay-${++sequence}`, action: 'revoke', expectedRevision: first.json.review.policy.revision })
    assert.equal(revoked.status, 200)
    const replay = await f.decision(request)
    assert.equal(replay.status, 200)
    assert.equal(replay.json.requestId, request.requestId)
    assert.equal(replay.json.review.policy.approval, null, 'receipt replay never resurrects an old grant')
    const drift = await f.decision({ ...request, approval: { ...request.approval, maxCallsPerRun: 3 } })
    assert.equal(drift.status, 409)
  } finally { f.cleanup() }
})

test('stale reviewed definition, destination relation, or sharing state returns conflict', async () => {
  const f = provision()
  try {
    const initial = (await f.review()).json as RoutineMcpReview
    const approval = await f.decision({ requestId: `stale-definition-${++sequence}`, action: 'approve', approval: f.intent(initial) })
    assert.equal(approval.status, 200)
    store.updateSchedule(f.task.id, { prompt: 'Changed after review.' })
    const staleDefinition = await f.decision({ requestId: `stale-def-decision-${++sequence}`, action: 'approve', approval: f.intent(initial) })
    assert.equal(staleDefinition.status, 409)

    const live = (await f.review()).json as RoutineMcpReview
    const reapproved = await f.decision({ requestId: `review-rel-${++sequence}`, action: 'approve', approval: f.intent(live) })
    assert.equal(reapproved.status, 200)
    store.applyRelationOp({ kind: 'set-schedule-session', scheduleId: f.task.id, scheduleName: f.task.name,
      cadence: f.task.cadence, sessionLabel: 'Reviewed destination' }, owner)
    const staleRelation = await f.decision({ requestId: `stale-rel-decision-${++sequence}`, action: 'approve', approval: f.intent(live) })
    assert.equal(staleRelation.status, 409)

    const afterRelation = (await f.review()).json as RoutineMcpReview
    const relationApproved = await f.decision({ requestId: `review-audience-${++sequence}`, action: 'approve', approval: f.intent(afterRelation) })
    assert.equal(relationApproved.status, 200)
    const grant = store.createGrant({ subject: { kind: 'schedule', id: f.task.id }, audience: { kind: 'org', orgId: audience }, tier: 'view' }, owner)
    assert.ok(grant && typeof grant === 'object')
    const staleAudience = await f.decision({ requestId: `stale-audience-${++sequence}`, action: 'approve', approval: f.intent(afterRelation) })
    assert.equal(staleAudience.status, 409)
    store.revokeGrant(grant.id, owner)
  } finally { f.cleanup() }
})

test('source-account precondition blocks a stale browser mutation before validation', async () => {
  const f = provision()
  try {
    const stale = await f.decision({ invalid: true }, { ...f.headers, 'x-account-transition-source': 'session:user-ada' })
    assert.equal(stale.status, 409)
    assert.equal(stale.json.error.code, 'conflict')
    assert.equal((await f.review()).json.policy.approval, null)
  } finally { f.cleanup() }
})

test('remote MCP catalog generates the permission tool and re-enters the same owner policy', async () => {
  const f = provision()
  try {
    const list = await call('POST', '/mcp', { jsonrpc: '2.0', id: ++sequence, method: 'tools/list' }, f.headers)
    const route = buildRouter().list().find(entry => entry.method === 'GET' && entry.pattern === '/schedules/:id/mcp-permission')!
    const generated = toolNameFor(route.method, route.pattern)
    assert.ok(list.json.result.tools.some((entry: { name: string }) => entry.name === generated), 'the real route contributes a remote catalog tool')
    const remote = await call('POST', '/mcp', { jsonrpc: '2.0', id: ++sequence, method: 'tools/call',
      params: { name: generated, arguments: { id: f.task.id } } }, f.headers)
    assert.equal(remote.status, 200)
    assert.equal(remote.json.result.isError, false)
    const payload = JSON.parse(remote.json.result.content[0].text)
    assert.equal(payload.status, 200)
    assert.equal(payload.body.routineId, f.task.id)

    const shared = await call('POST', '/mcp', { jsonrpc: '2.0', id: ++sequence, method: 'tools/call',
      params: { name: generated, arguments: { id: f.task.id } } }, { 'x-tenant-id': audience })
    assert.equal(shared.status, 200)
    const sharedPayload = JSON.parse(shared.json.result.content[0].text)
    assert.equal(sharedPayload.status, 404, 'remote MCP traverses the same owner-only route wall')
  } finally { f.cleanup() }
})
