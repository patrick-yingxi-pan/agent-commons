import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import type { McpStdioConnection } from '../mcpStdioClient.ts'
import { call } from '../testkit/http.ts'
import { signSession } from '../auth.ts'
import { accounts } from '../accounts.ts'
import { configureMcpRuntime, initializeMcpRuntime } from '../mcpRuntime.ts'
import { store } from '../store/index.ts'
import { buildRouter } from './index.ts'

let sequence = 0
const cookieOf = (response: { headers: Record<string, string> }) => response.headers['set-cookie']?.split(';')[0] ?? ''
const fakeConnection: McpStdioConnection = {
  request: async () => ({ jsonrpc: '2.0', id: 1, result: {} }),
  initialized: async () => undefined,
  close: async () => ({ code: 'released' }),
  closed: Promise.resolve({ code: 'released' }),
}

afterEach(() => configureMcpRuntime({ deviceBearerAvailable: false, allowLoopback: false }))

async function account(label: string) {
  const tag = `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${++sequence}`
  const email = `${tag}@mcp-stdio.example`
  const response = await call('POST', '/auth/signup', { name: label, email, password: `${tag}-password` })
  assert.equal(response.status, 200)
  return { userId: response.json.user.id as string, tenantId: response.json.tenant.id as string,
    email, cookie: cookieOf(response) }
}

function scopedHeaders(userId: string, tenantId: string) {
  const token = signSession({ userId, tenantId, iat: Date.now() })
  return { cookie: `uw_session=${token}`, 'x-account-transition-source': `session:${userId}` }
}

async function enableStdio(openStdio: NonNullable<Parameters<typeof configureMcpRuntime>[0]['openStdio']> = () => fakeConnection) {
  configureMcpRuntime({ deviceBearerAvailable: false, allowLoopback: false, localProcessesAvailable: true,
    openStdio, synchronizeStdioBindings: async () => ({ available: true }) })
  await initializeMcpRuntime(store.mcpCredentialBindings(), store.mcpStdioBindings())
}

test('stdio source is a source-fenced, cookie-only person ceremony with minimal no-store binding', async () => {
  const owner = await account('Stdio Source Owner')
  const member = await account('Stdio Source Member')
  const org = await call('POST', '/orgs', { name: `MCP stdio shared ${sequence}` }, { cookie: owner.cookie })
  assert.equal(org.status, 201)
  const invite = await call('POST', `/orgs/${org.json.id}/invites`, { email: member.email }, { cookie: owner.cookie })
  assert.equal(invite.status, 201)
  assert.equal((await call('POST', `/me/invites/${invite.json.id}/accept`, undefined, { cookie: member.cookie })).status, 200)
  assert.ok(accounts.identityFor(owner.userId, org.json.id))
  assert.ok(accounts.identityFor(member.userId, org.json.id))

  await enableStdio()
  const ownerHeaders = scopedHeaders(owner.userId, org.json.id)
  const created = await call('POST', '/mcp-connections', {
    transport: 'stdio', creationId: `stdio-source-${sequence}`, label: 'Local source fixture',
  }, ownerHeaders)
  assert.equal(created.status, 200, JSON.stringify(created.json))
  assert.equal(created.json.connection.transport, 'stdio')
  const id = created.json.connection.id as string
  const path = `/mcp-connections/${id}/stdio-source`

  const stale = await call('GET', '/mcp-connections/missing/stdio-source', undefined, {
    ...ownerHeaders, 'x-account-transition-source': `session:${member.userId}`,
  })
  assert.equal(stale.status, 409, 'source preflight runs before private lookup')
  const response = await call('GET', path, undefined, ownerHeaders)
  assert.equal(response.status, 200, JSON.stringify(response.json))
  assert.equal(response.headers['cache-control'], 'no-store')
  assert.deepEqual(Object.keys(response.json).sort(), ['binding', 'connection'])
  assert.deepEqual(Object.keys(response.json.binding).sort(), ['connectionId', 'connectionRevision', 'ownerUserId', 'tenantId'])
  assert.deepEqual(Object.keys(response.json.connection).sort(), ['inspectionOperationId', 'revision', 'status'])
  assert.deepEqual(response.json, {
    binding: { tenantId: org.json.id, ownerUserId: owner.userId, connectionId: id, connectionRevision: 0 },
    connection: { revision: 0, status: 'unverified', inspectionOperationId: null },
  })
  assert.equal((await call('GET', path, undefined, { authorization: `Bearer ${signSession({
    userId: owner.userId, tenantId: org.json.id, iat: Date.now(),
  })}` })).status, 401, 'a bearer identity is not the native browser setup ceremony')
  assert.equal((await call('GET', path, undefined, scopedHeaders(member.userId, org.json.id))).status, 404,
    'same-tenant membership does not grant this person-owned row')

  const serialized = JSON.stringify(response.json)
  assert.doesNotMatch(serialized, /MCP_STDIO_|executable|arguments|cwd|environment|launch/i)

  configureMcpRuntime({ deviceBearerAvailable: false, allowLoopback: false })
  const unavailable = await call('GET', path, undefined, ownerHeaders)
  assert.equal(unavailable.status, 409)
  assert.equal(unavailable.json.error.code, 'capability_unavailable')
  assert.equal(unavailable.headers['cache-control'], 'no-store')
})

test('stdio source is a native-only route and never part of workspace API discovery', () => {
  const route = buildRouter().list().find(row => row.method === 'GET' && row.pattern === '/mcp-connections/:id/stdio-source')
  assert.ok(route)
  assert.equal(route.access.kind, 'form')
  if (route.access.kind === 'form') {
    assert.equal(route.access.ui, undefined)
    assert.match(route.access.reason, /native local-process setup/)
  }
})

test('stdio inspection errors expose only fixed upstream messages, never native diagnostics', async () => {
  const owner = await account('Stdio Error Owner')
  const secretDiagnostic = '/private/path/should-never-be-returned'
  await enableStdio(() => { throw new Error(secretDiagnostic) })
  const headers = scopedHeaders(owner.userId, owner.tenantId)
  const created = await call('POST', '/mcp-connections', {
    transport: 'stdio', creationId: `stdio-error-${sequence}`, label: 'Local source fixture',
  }, headers)
  assert.equal(created.status, 200)
  const id = created.json.connection.id as string
  const response = await call('POST', `/mcp-connections/${id}/inspect`, {
    operationId: 'stdio-inspection-error', expectedRevision: 0, grantReference: `MCP_STDIO_${'A'.repeat(32)}`,
  }, headers)
  assert.equal(response.status, 502)
  assert.equal(response.json.error.code, 'upstream_unavailable')
  assert.doesNotMatch(JSON.stringify(response.json), /private\/path|diagnostic|should-never/)
  const privateRow = store.privateMcpConnection(id, owner.tenantId, owner.userId)
  assert.ok(privateRow)
  assert.equal(privateRow.revision, 0, 'the recognized upstream failure must settle before the durable inspection commit')
  assert.equal(privateRow.grantReference, undefined)
  const binding = store.mcpStdioBindings().find(row => row.binding.connectionId === id)
  assert.ok(binding)
  assert.equal(binding.reference, null, 'no native binding is published for a definitive precommit refusal')
})
