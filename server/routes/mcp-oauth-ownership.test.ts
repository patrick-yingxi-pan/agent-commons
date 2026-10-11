import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { call } from '../testkit/http.ts'
import { signSession } from '../auth.ts'
import { accounts } from '../accounts.ts'
import { configureMcpRuntime, initializeMcpRuntime } from '../mcpRuntime.ts'
import { store } from '../store/index.ts'

let sequence = 0
const publicEndpoint = 'https://mcp.example.test/oauth-tools'
const cookieOf = (r: { headers: Record<string, string> }) => r.headers['set-cookie']?.split(';')[0] ?? ''

afterEach(() => configureMcpRuntime({ deviceBearerAvailable: false, allowLoopback: false }))

async function account(label: string) {
  const tag = `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${++sequence}`
  const email = `${tag}@mcp-oauth.example`
  const response = await call('POST', '/auth/signup', { name: label, email, password: `${tag}-password` })
  assert.equal(response.status, 200)
  return { userId: response.json.user.id as string, homeTenantId: response.json.tenant.id as string,
    email, cookie: cookieOf(response) }
}

function scopedHeaders(userId: string, tenantId: string) {
  const token = signSession({ userId, tenantId, iat: Date.now() })
  return { cookie: `uw_session=${token}`, 'x-account-transition-source': `session:${userId}` }
}

test('OAuth connection lifecycle is person-owned inside a genuinely shared organization tenant', async () => {
  const owner = await account('OAuth Connection Owner')
  const member = await account('OAuth Same-Tenant Member')
  const org = await call('POST', '/orgs', { name: `MCP OAuth Shared ${sequence}` }, { cookie: owner.cookie })
  assert.equal(org.status, 201)
  const invite = await call('POST', `/orgs/${org.json.id}/invites`, { email: member.email }, { cookie: owner.cookie })
  assert.equal(invite.status, 201)
  assert.equal((await call('POST', `/me/invites/${invite.json.id}/accept`, undefined, { cookie: member.cookie })).status, 200)
  assert.ok(accounts.identityFor(owner.userId, org.json.id), 'owner has an actual live org membership')
  assert.ok(accounts.identityFor(member.userId, org.json.id), 'member has an actual live org membership')

  configureMcpRuntime({ deviceBearerAvailable: false, deviceOAuthAvailable: true, allowLoopback: false,
    resolveOAuthCredential: async () => 'test-only-token', synchronizeBindings: async () => ({ available: true }) })
  await initializeMcpRuntime(store.mcpCredentialBindings())
  const ownerHeaders = scopedHeaders(owner.userId, org.json.id)
  const memberHeaders = scopedHeaders(member.userId, org.json.id)
  const beforeMemberships = accounts.memberships.slice()
  const events: Array<{ type: string; tenantId?: string; ownerUserId?: string; id?: string }> = []
  const unsubscribe = store.subscribe(event => events.push(event as typeof events[number]))
  const creationId = `mcp-oauth-owner-${sequence}`
  const body = { creationId, label: 'Owner private account', endpoint: publicEndpoint, authentication: 'device-oauth' }

  const forged = await call('POST', '/mcp-connections', { ...body, ownerUserId: member.userId }, ownerHeaders)
  assert.equal(forged.status, 400, 'owner identity is taken from the authenticated cookie, never request JSON')
  const created = await call('POST', '/mcp-connections', body, ownerHeaders)
  assert.equal(created.status, 200)
  assert.equal(created.json.connection.authentication, 'device-oauth')
  assert.equal(created.json.connection.ownerUserId, undefined)
  assert.equal(created.json.connection.endpoint, undefined)
  const id = created.json.connection.id as string

  const ownerList = await call('GET', '/mcp-connections', undefined, ownerHeaders)
  const memberList = await call('GET', '/mcp-connections', undefined, memberHeaders)
  assert.ok(ownerList.json.connections.some((row: { id: string }) => row.id === id))
  assert.ok(!memberList.json.connections.some((row: { id: string }) => row.id === id), 'same tenant does not imply OAuth ownership')
  assert.equal((await call('GET', `/mcp-connections/${id}`, undefined, memberHeaders)).status, 404)

  const ownerContexts = await call('GET', '/saved-contexts', undefined, ownerHeaders)
  const memberContexts = await call('GET', '/saved-contexts', undefined, memberHeaders)
  assert.ok(ownerContexts.json.contexts.some((row: { id: string }) => row.id === id))
  assert.ok(!memberContexts.json.contexts.some((row: { id: string }) => row.id === id), 'saved-context projection is actor-filtered')
  const detailPath = `/connectors/detail?id=${encodeURIComponent(id)}&label=${encodeURIComponent(body.label)}&kind=mcp`
  assert.equal((await call('GET', detailPath, undefined, ownerHeaders)).status, 200)
  assert.equal((await call('GET', detailPath, undefined, memberHeaders)).status, 404, 'connector detail is actor-filtered')

  const hidden = await Promise.all([
    call('POST', `/mcp-connections/${id}/inspect`, { operationId: `member-inspect-${sequence}`, expectedRevision: 0 }, memberHeaders),
    call('POST', `/mcp-connections/${id}/disconnect`, { expectedRevision: 0 }, memberHeaders),
    call('DELETE', `/mcp-connections/${id}`, { expectedRevision: 0 }, memberHeaders),
    call('POST', `/mcp-connections/${id}/credential-cleanup`, {}, memberHeaders),
  ])
  assert.deepEqual(hidden.map(response => response.status), [404, 404, 404, 404],
    'inspect, disconnect, removal and cleanup all hide another person’s row')

  const disconnected = await call('POST', `/mcp-connections/${id}/disconnect`, { expectedRevision: 0 }, ownerHeaders)
  assert.equal(disconnected.status, 200)
  assert.equal(disconnected.json.connection.revision, 1, 'owner disconnect advances the reviewed revision')
  const removed = await call('DELETE', `/mcp-connections/${id}`, { expectedRevision: 1 }, ownerHeaders)
  assert.equal(removed.status, 200)
  assert.equal(removed.json.removed, true)

  const privateEvents = events.filter(event => event.id === id)
  assert.deepEqual(privateEvents.map(event => event.type), ['savedcontext.changed', 'connector.status', 'savedcontext.changed'])
  for (const event of privateEvents) {
    assert.equal(event.ownerUserId, owner.userId, 'each lifecycle invalidation retains the personal owner stamp')
    assert.equal(store.eventVisibleToTenant(event as never, org.json.id), false, 'tenant-only event delivery has no owner authority')
    assert.equal(store.eventVisibleToTenant(event as never, org.json.id, member.userId), false, 'a same-tenant member cannot observe private events')
    assert.equal(store.eventVisibleToTenant(event as never, member.homeTenantId, owner.userId), false, 'foreign tenant cannot observe private events')
    assert.equal(store.eventVisibleToTenant(event as never, org.json.id, owner.userId), true, 'the current owner can observe private events')
  }

  const eventCount = events.length
  accounts.memberships = accounts.memberships.filter(row => !(row.userId === owner.userId && row.tenantId === org.json.id))
  assert.equal(store.identity(ownerHeaders).via, 'default', 'a stale owner cookie no longer resolves after membership loss')
  assert.ok(!store.mcpConnections(org.json.id, owner.userId).some(row => row.id === id))
  assert.equal(store.mcpConnection(id, org.json.id, owner.userId), undefined)
  assert.equal(store.privateMcpConnection(id, org.json.id, owner.userId), undefined)
  assert.ok(!store.savedContexts(org.json.id, owner.userId).contexts.some(row => row.id === id))
  assert.equal(store.eventVisibleToTenant(privateEvents[0] as never, org.json.id, owner.userId), false,
    'historical owner-stamped events are hidden after membership is revoked')
  const afterRevocation = await Promise.all([
    call('GET', '/mcp-connections', undefined, ownerHeaders),
    call('GET', `/mcp-connections/${id}`, undefined, ownerHeaders),
    call('GET', '/saved-contexts', undefined, ownerHeaders),
    call('GET', detailPath, undefined, ownerHeaders),
  ])
  assert.ok(afterRevocation[0]!.status === 401 || (afterRevocation[0]!.status === 200 &&
    !afterRevocation[0]!.json.connections.some((row: { id: string }) => row.id === id)), 'stale owner cannot list the row')
  assert.ok([401, 404].includes(afterRevocation[1]!.status), 'stale owner cannot read detail')
  assert.ok(afterRevocation[2]!.status === 401 || (afterRevocation[2]!.status === 200 &&
    !afterRevocation[2]!.json.contexts.some((row: { id: string }) => row.id === id)), 'stale owner cannot read saved context')
  assert.ok([401, 404].includes(afterRevocation[3]!.status), 'stale owner cannot read connector detail')
  assert.equal(events.length, eventCount, 'revoked reads do not publish new side effects')
  accounts.memberships = beforeMemberships
  unsubscribe()
  configureMcpRuntime({ deviceBearerAvailable: false, allowLoopback: false })
})

test('OAuth creation stays unavailable until a native resolver and custody synchronizer are installed', async () => {
  const owner = await account('OAuth Capability Gate')
  configureMcpRuntime({ deviceBearerAvailable: false, allowLoopback: false })
  const response = await call('POST', '/mcp-connections', {
    creationId: `mcp-oauth-unavailable-${sequence}`, label: 'OAuth unavailable', endpoint: publicEndpoint,
    authentication: 'device-oauth',
  }, { cookie: owner.cookie })
  assert.equal(response.status, 409, JSON.stringify(response.json))
  assert.equal(response.json.error.code, 'capability_unavailable')
  configureMcpRuntime({ deviceBearerAvailable: false, allowLoopback: false })
})
