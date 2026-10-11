import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { call } from '../testkit/http.ts'
import { signSession } from '../auth.ts'
import { accounts } from '../accounts.ts'
import { configureMcpRuntime, initializeMcpRuntime } from '../mcpRuntime.ts'
import { MCP_MODERN_VERSION } from '../mcpProtocol.ts'
import { MCP_SCHEMA_ADMISSION_VERSION, mcpToolSchemaHash } from '../mcpToolAdmission.ts'
import { store } from '../store/index.ts'
import type { ToolActivity } from '../../contract/index.ts'
import { conversationContext } from '../conversationContext.ts'

let sequence = 0
const oauthEndpoint = 'https://owner-scoped.example.test/mcp'
const credentialReference = `MCP_DESKTOP_${'F'.repeat(32)}`
const tool = { name: 'lookup', inputSchema: { type: 'object', properties: { query: { type: 'string' } },
  required: ['query'], additionalProperties: false } }
const schemaHash = mcpToolSchemaHash(tool)
const cookieOf = (r: { headers: Record<string, string> }) => r.headers['set-cookie']?.split(';')[0] ?? ''
afterEach(() => configureMcpRuntime({ deviceBearerAvailable: false, allowLoopback: false }))

async function account(label: string) {
  const tag = `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${++sequence}`
  const email = `${tag}@oauth-approval.example`
  const response = await call('POST', '/auth/signup', { name: label, email, password: `${tag}-password` })
  assert.equal(response.status, 200)
  return { userId: response.json.user.id as string, email, cookie: cookieOf(response) }
}

function headers(userId: string, tenantId: string) {
  return { cookie: `uw_session=${signSession({ userId, tenantId, iat: Date.now() })}`,
    'x-account-transition-source': `session:${userId}` }
}

test('OAuth proposal consent and exact replay stay bound to its actual owner inside a shared tenant', async () => {
  const owner = await account('OAuth Approval Owner')
  const member = await account('OAuth Approval Member')
  const org = await call('POST', '/orgs', { name: `OAuth approval ${sequence}` }, { cookie: owner.cookie })
  assert.equal(org.status, 201)
  const invite = await call('POST', `/orgs/${org.json.id}/invites`, { email: member.email }, { cookie: owner.cookie })
  assert.equal(invite.status, 201)
  assert.equal((await call('POST', `/me/invites/${invite.json.id}/accept`, undefined, { cookie: member.cookie })).status, 200)
  assert.ok(accounts.identityFor(owner.userId, org.json.id))
  assert.ok(accounts.identityFor(member.userId, org.json.id))

  configureMcpRuntime({ deviceBearerAvailable: false, deviceOAuthAvailable: true, allowLoopback: false,
    resolveOAuthCredential: async () => 'never-used-owner-test-token', synchronizeBindings: async () => ({ available: true }) })
  await initializeMcpRuntime(store.mcpCredentialBindings())
  const connectionId = `mcp-connection-${(++sequence).toString(16).padStart(32, '0')}`
  store.createMcpConnection({ id: connectionId, label: 'Owner-only MCP', endpoint: oauthEndpoint, authentication: 'device-oauth' },
    org.json.id, false, owner.userId)
  store.commitMcpInspection(connectionId, org.json.id, 0, {
    protocolVersion: MCP_MODERN_VERSION, cleanup: 'not-needed', tools: [tool],
    schemaAdmission: { version: MCP_SCHEMA_ADMISSION_VERSION, hashes: [schemaHash] },
  }, Date.now(), credentialReference, undefined, owner.userId)

  const session = store.createSession(`Owner OAuth consent ${sequence}`, org.json.id)
  const ownerHeaders = headers(owner.userId, org.json.id)
  const memberHeaders = headers(member.userId, org.json.id)
  const workspace = { workspaces: [], repos: [], connectors: [], attachments: [] }
  const attached = await call('PATCH', `/sessions/${session.id}/context-state`, {
    operations: [{ action: 'attach', context: { id: connectionId, type: 'mcp', label: 'Owner-only MCP', scope: '*' } }], workspace,
  }, ownerHeaders)
  assert.equal(attached.status, 200, JSON.stringify(attached.json))
  assert.ok(attached.json.contexts.some((context: { id: string }) => context.id === connectionId))
  const ownerProjection = await call('GET', `/sessions/${session.id}`, undefined, ownerHeaders)
  const memberProjection = await call('GET', `/sessions/${session.id}`, undefined, memberHeaders)
  assert.ok(ownerProjection.json.contexts.some((context: { id: string }) => context.id === connectionId))
  assert.ok(!memberProjection.json.contexts.some((context: { id: string }) => context.id === connectionId),
    'same-tenant conversation projection does not disclose a private OAuth attachment')
  const memberContexts = await call('GET', `/sessions/${session.id}/contexts`, undefined, memberHeaders)
  assert.ok(!memberContexts.json.some((context: { id: string }) => context.id === connectionId))
  assert.ok(conversationContext(session.id, org.json.id, owner.userId).externalMcpConnections.some(row => row.id === connectionId))
  assert.ok(!conversationContext(session.id, org.json.id, member.userId).externalMcpConnections.some(row => row.id === connectionId),
    'model tool derivation receives only connections owned by the authenticated person')

  const activityId = `oauth-owner-proposal-${sequence}`
  const activity: ToolActivity = {
    id: activityId, tool: 'mcp__owner__lookup', connector: 'Owner-only MCP', connectorId: connectionId,
    kind: 'action', status: 'proposed', summary: 'Look up the reviewed query', input: { query: 'albatross' },
    mcp: { connectionRevision: 1, toolName: 'lookup', schemaHash },
  }
  const appended = store.appendMessage(session.id, {
    id: store.mintMessageId('assistant'), role: 'assistant', content: 'Approve this lookup?', toolActivities: [activity],
  }, { actorUserId: owner.userId })
  assert.ok(appended)
  const publicActivity = store.getToolActivity(session.id, activityId)
  assert.ok(publicActivity)
  assert.equal(Object.hasOwn(publicActivity, 'ownerUserId'), false)
  assert.equal(JSON.stringify(publicActivity).includes(owner.userId), false, 'raw owner anchor is not projected on ToolActivity')

  const path = `/sessions/${session.id}/tool-activities/${activityId}`
  const key = `oauth-owner-decline-${sequence}`
  const decisionHeaders = { ...ownerHeaders, 'idempotency-key': key }
  const denied = await call('POST', path, { decision: 'decline' }, { ...memberHeaders, 'idempotency-key': key })
  assert.equal(denied.status, 404, 'same-tenant person cannot decide an owner-private proposal')
  assert.equal(store.getToolActivity(session.id, activityId)?.status, 'proposed', 'denial does not claim or resolve the proposal')

  const declined = await call('POST', path, { decision: 'decline' }, decisionHeaders)
  assert.equal(declined.status, 200, JSON.stringify(declined.json))
  assert.equal(declined.json.status, 'declined')
  const replay = await call('POST', path, { decision: 'decline' }, decisionHeaders)
  assert.equal(replay.status, 200)
  assert.equal(replay.json.status, 'declined', 'the owner recovers the exact settled acknowledgement')
  const foreignReplay = await call('POST', path, { decision: 'decline' }, { ...memberHeaders, 'idempotency-key': key })
  assert.equal(foreignReplay.status, 404, 'owner receipt replay is hidden from the same-tenant member')
  const publicSession = await call('GET', `/sessions/${session.id}`, undefined, ownerHeaders)
  assert.equal(publicSession.status, 200)
  assert.equal(JSON.stringify(publicSession.json.messages).includes(owner.userId), false)
})
