import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { call } from '../testkit/http.ts'
import { signSession } from '../auth.ts'
import { accounts } from '../accounts.ts'
import { configureMcpRuntime, initializeMcpRuntime } from '../mcpRuntime.ts'
import { store } from '../store/index.ts'
import { buildRouter } from './index.ts'

let sequence = 0
const endpoint = 'https://oauth-source.example.test/mcp'
const cookieOf = (r: { headers: Record<string, string> }) => r.headers['set-cookie']?.split(';')[0] ?? ''

afterEach(() => configureMcpRuntime({ deviceBearerAvailable: false, allowLoopback: false }))

async function account(label: string) {
  const tag = `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${++sequence}`
  const response = await call('POST', '/auth/signup', { name: label, email: `${tag}@oauth-source.example`, password: `${tag}-password` })
  assert.equal(response.status, 200)
  return { userId: response.json.user.id as string, homeTenantId: response.json.tenant.id as string,
    email: `${tag}@oauth-source.example`, cookie: cookieOf(response) }
}

function enableOAuth() {
  configureMcpRuntime({ deviceBearerAvailable: false, deviceOAuthAvailable: true, allowLoopback: false,
    resolveOAuthCredential: async () => 'test-only-token', synchronizeBindings: async () => ({ available: true }) })
  return initializeMcpRuntime(store.mcpCredentialBindings())
}

test('OAuth source is a cookie-only owner ceremony with minimal no-store binding', async () => {
  const owner = await account('OAuth Source Owner')
  const member = await account('OAuth Source Member')
  const org = await call('POST', '/orgs', { name: `OAuth source shared ${sequence}` }, { cookie: owner.cookie })
  assert.equal(org.status, 201)
  const invite = await call('POST', `/orgs/${org.json.id}/invites`, { email: member.email }, { cookie: owner.cookie })
  assert.equal(invite.status, 201)
  assert.equal((await call('POST', `/me/invites/${invite.json.id}/accept`, undefined, { cookie: member.cookie })).status, 200)
  assert.ok(accounts.identityFor(member.userId, org.json.id), 'member has an active account membership in the shared tenant')

  await enableOAuth()
  const ownerHeaders = { cookie: `uw_session=${signSession({ userId: owner.userId, tenantId: org.json.id, iat: Date.now() })}` }
  const created = await call('POST', '/mcp-connections', {
    creationId: `oauth-source-${sequence}`, label: 'Source fixture', endpoint, authentication: 'device-oauth',
  }, ownerHeaders)
  assert.equal(created.status, 200, JSON.stringify(created.json))
  const id = created.json.connection.id as string
  const path = `/mcp-connections/${id}/oauth-source`
  const response = await call('GET', path, undefined, ownerHeaders)
  assert.equal(response.status, 200, JSON.stringify(response.json))
  assert.equal(response.headers['cache-control'], 'no-store')
  assert.deepEqual(Object.keys(response.json).sort(), ['binding', 'connection', 'ownerUserId'])
  assert.deepEqual(Object.keys(response.json.binding).sort(), ['connectionId', 'endpoint', 'tenantId'])
  assert.deepEqual(Object.keys(response.json.connection).sort(), ['authentication', 'id', 'revision', 'status'])
  assert.deepEqual(response.json, {
    ownerUserId: owner.userId,
    binding: { tenantId: org.json.id, connectionId: id, endpoint },
    connection: { id, authentication: 'device-oauth', revision: 0, status: 'unverified' },
  })
  const serialized = JSON.stringify(response.json)
  assert.ok(!serialized.includes('test-only-token'))
  assert.ok(!serialized.includes('credentialReference'))
  assert.ok(!serialized.includes('tools'))

  const memberHeaders = { cookie: `uw_session=${signSession({ userId: member.userId, tenantId: org.json.id, iat: Date.now() })}` }
  assert.equal((await call('GET', path, undefined, memberHeaders)).status, 404, 'same-tenant member cannot inspect OAuth source')
  const bearerOnly = { authorization: `Bearer ${signSession({ userId: owner.userId, tenantId: org.json.id, iat: Date.now() })}` }
  assert.equal((await call('GET', path, undefined, bearerOnly)).status, 401, 'bearer identity is not a browser OAuth ceremony')

  const staleSource = await call('GET', '/mcp-connections/missing/oauth-source', undefined, {
    ...ownerHeaders, 'x-account-transition-source': `session:${member.userId}`,
  })
  assert.equal(staleSource.status, 409, 'source preflight wins before private lookup')

  configureMcpRuntime({ deviceBearerAvailable: false, allowLoopback: false })
  const unavailable = await call('GET', path, undefined, ownerHeaders)
  assert.equal(unavailable.status, 409)
  assert.equal(unavailable.json.error.code, 'capability_unavailable')
  assert.equal(unavailable.headers['cache-control'], 'no-store')

  await enableOAuth()
  const membershipSnapshot = accounts.memberships.slice()
  accounts.memberships = accounts.memberships.filter(row => !(row.userId === owner.userId && row.tenantId === org.json.id))
  const revoked = await call('GET', path, undefined, ownerHeaders)
  assert.equal(revoked.status, 401, 'a revoked cookie no longer authenticates and cannot reveal the previously owned source')
  accounts.memberships = membershipSnapshot
})

test('OAuth source route remains a native-only form outside workspace capability parity', () => {
  const route = buildRouter().list().find(row => row.method === 'GET' && row.pattern === '/mcp-connections/:id/oauth-source')
  assert.ok(route)
  assert.equal(route.access.kind, 'form')
  if (route.access.kind === 'form') {
    assert.equal(route.access.ui, undefined)
    assert.match(route.access.reason, /native-host OAuth authorization transport/)
  }
})
