import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import type { ToolActivity } from '../../contract/index.ts'
import { call } from '../testkit/http.ts'
import { signSession } from '../auth.ts'
import { accounts } from '../accounts.ts'
import { configureMcpRuntime, initializeMcpRuntime } from '../mcpRuntime.ts'
import { MCP_MODERN_VERSION } from '../mcpProtocol.ts'
import { MCP_SCHEMA_ADMISSION_VERSION, mcpToolSchemaHash } from '../mcpToolAdmission.ts'
import { store } from '../store/index.ts'
import { mcpConnectionCreationId } from '../mcpConnections.ts'

let sequence = 0
const cookieOf = (response: { headers: Record<string, string> }) => response.headers['set-cookie']?.split(';')[0] ?? ''
afterEach(() => configureMcpRuntime({ deviceBearerAvailable: false, allowLoopback: false }))

async function newAccount(label: string) {
  const tag = `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${++sequence}`
  const response = await call('POST', '/auth/signup', { name: label, email: `${tag}@eligibility.test`, password: `${tag}-password` })
  assert.equal(response.status, 200)
  return { userId: response.json.user.id as string, email: `${tag}@eligibility.test`, cookie: cookieOf(response) }
}

test('consent controls are actor-relative without changing the shared transcript', async () => {
  const owner = await newAccount('Eligibility owner')
  const peer = await newAccount('Eligibility peer')
  const org = await call('POST', '/orgs', { name: `Eligibility ${sequence}` }, { cookie: owner.cookie })
  assert.equal(org.status, 201)
  const invitation = await call('POST', `/orgs/${org.json.id}/invites`, { email: peer.email }, { cookie: owner.cookie })
  assert.equal(invitation.status, 201)
  assert.equal((await call('POST', `/me/invites/${invitation.json.id}/accept`, undefined, { cookie: peer.cookie })).status, 200)

  configureMcpRuntime({ deviceBearerAvailable: false, deviceOAuthAvailable: true, allowLoopback: false,
    resolveOAuthCredential: async () => 'unused-eligibility-fixture', synchronizeBindings: async () => ({ available: true }) })
  await initializeMcpRuntime(store.mcpCredentialBindings())
  const tenantId = org.json.id as string
  const connectionId = mcpConnectionCreationId(tenantId, `eligibility-${sequence}`, owner.userId)
  const tool = { name: 'lookup', inputSchema: { type: 'object' as const, properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false } }
  const schemaHash = mcpToolSchemaHash(tool)
  store.createMcpConnection({ id: connectionId, label: 'Eligibility MCP', endpoint: 'https://eligibility.example.test/mcp', authentication: 'device-oauth' }, tenantId, false, owner.userId)
  store.commitMcpInspection(connectionId, tenantId, 0, {
    protocolVersion: MCP_MODERN_VERSION, cleanup: 'not-needed', tools: [tool],
    schemaAdmission: { version: MCP_SCHEMA_ADMISSION_VERSION, hashes: [schemaHash] },
  }, Date.now(), `MCP_DESKTOP_${'A'.repeat(32)}`, undefined, owner.userId)

  const session = store.createSession(`Eligibility session ${sequence}`, tenantId)
  const activity: ToolActivity = {
    id: `eligibility-activity-${sequence}`, tool: 'mcp__eligibility__lookup', connector: 'Eligibility MCP', connectorId: connectionId,
    kind: 'action', status: 'proposed', summary: 'Look up this record', input: { query: 'exact' },
    mcp: { connectionRevision: 1, toolName: 'lookup', schemaHash },
  }
  store.appendMessage(session.id, { id: store.mintMessageId('assistant'), role: 'assistant', content: 'Review this call.', toolActivities: [activity] }, { actorUserId: owner.userId })
  const verified = (userId: string) => ({
    cookie: `uw_session=${signSession({ userId, tenantId, iat: Date.now() })}`,
    'x-account-transition-source': `session:${userId}`,
  })
  const ownerSessionHeaders = verified(owner.userId)
  const peerHeaders = verified(peer.userId)
  const path = `/sessions/${session.id}/tool-activity-eligibility`
  const ownerRead = await call('GET', path, undefined, ownerSessionHeaders)
  assert.equal(ownerRead.status, 200, JSON.stringify(ownerRead.json))
  assert.equal(ownerRead.headers['cache-control'], 'no-store')
  assert.deepEqual(Object.keys(ownerRead.json).sort(), ['confirmActivityIds', 'decisionActivityIds'])
  assert.deepEqual(ownerRead.json.decisionActivityIds, [activity.id])
  assert.deepEqual(ownerRead.json.confirmActivityIds, [activity.id])
  assert.equal(JSON.stringify(ownerRead.json).includes(owner.userId), false, 'raw actor identity never reaches the projection')

  const activeMessages = session.messages
  const archivedMessages = session.compactedMessages
  session.compactedMessages = activeMessages
  session.messages = []
  const archivedRead = await call('GET', path, undefined, ownerSessionHeaders)
  assert.deepEqual(archivedRead.json, { decisionActivityIds: [], confirmActivityIds: [] },
    'an archived undecided proposal is history, not a fresh executable action')
  session.messages = activeMessages
  session.compactedMessages = archivedMessages

  const peerRead = await call('GET', path, undefined, peerHeaders)
  assert.equal(peerRead.status, 200)
  assert.deepEqual(peerRead.json, { decisionActivityIds: [], confirmActivityIds: [] }, 'same-tenant peer gets no OAuth controls')
  const transcript = await call('GET', `/sessions/${session.id}`, undefined, peerHeaders)
  assert.ok(transcript.json.messages.flatMap((message: { toolActivities?: ToolActivity[] }) => message.toolActivities ?? []).some((item: ToolActivity) => item.id === activity.id),
    'the ordinary shared transcript remains visible')

  store.disconnectMcpConnection(connectionId, tenantId, 1, owner.userId)
  const disconnected = await call('GET', path, undefined, ownerSessionHeaders)
  assert.deepEqual(disconnected.json.decisionActivityIds, [activity.id], 'owner can still decline an unavailable call')
  assert.deepEqual(disconnected.json.confirmActivityIds, [], 'stale connection revision cannot be confirmed')

  store.removeMcpConnection(connectionId, tenantId, 2, owner.userId)
  const retired = await call('GET', path, undefined, ownerSessionHeaders)
  assert.deepEqual(retired.json.decisionActivityIds, [activity.id], 'private frozen authority retains owner decline')
  assert.deepEqual(retired.json.confirmActivityIds, [])
  store.removeSession(session.id)
})

test('ordinary non-OAuth approvals retain their existing consent projection', async () => {
  const tenantId = store.defaultTenantId()
  const session = store.createSession(`Ordinary eligibility ${++sequence}`, tenantId)
  const activity: ToolActivity = {
    id: `ordinary-eligibility-${sequence}`, tool: 'web_search', connector: 'Search',
    kind: 'action', status: 'proposed', summary: 'Search the web', input: { query: 'example' },
  }
  store.appendMessage(session.id, {
    id: store.mintMessageId('assistant'), role: 'assistant', content: 'Review this search.', toolActivities: [activity],
  })

  const response = await call('GET', `/sessions/${session.id}/tool-activity-eligibility`)
  assert.equal(response.status, 200, JSON.stringify(response.json))
  assert.deepEqual(response.json, { decisionActivityIds: [activity.id], confirmActivityIds: [activity.id] })
  store.removeSession(session.id)
})
