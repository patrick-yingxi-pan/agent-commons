import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openMcpCredentialVault } from './mcpCredentialVault.mjs'
import { createDesktopMcpOAuthRuntime } from './mcpOAuthRuntime.mjs'

const issuer = 'https://login.example.test'
const binding = { tenantId: 'tenant-runtime', connectionId: 'connection-runtime', endpoint: 'https://mcp.example.test/agent' }
const ownerUserId = 'owner-runtime'
const source = { tenantId: binding.tenantId, userId: ownerUserId }
const metadata = { issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`,
  registration_endpoint: `${issuer}/register`, response_types_supported: ['code'],
  grant_types_supported: ['authorization_code', 'refresh_token'], token_endpoint_auth_methods_supported: ['none'],
  code_challenge_methods_supported: ['S256'], scopes_supported: ['files:read'] }

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'ac-oauth-runtime-'))
  const vault = await openMcpCredentialVault({ filePath: join(directory, 'vault.json'),
    encrypt: text => Buffer.from(text).map(byte => byte ^ 0xa5), decrypt: bytes => Buffer.from(bytes).map(byte => byte ^ 0xa5).toString() })
  let stamp = 'owner:1'
  let connection = { id: binding.connectionId, authentication: 'device-oauth', revision: 0,
    status: 'unverified', inspectionOperationId: null }
  let reference: string
  const calls = { browser: 0, exchange: 0, refresh: 0, closed: 0, inspect: 0 }
  const runtime = createDesktopMcpOAuthRuntime({ vault,
    readSession: () => ({ stamp, origin: 'http://127.0.0.1:8787', cookie: 'uw_session=runtime-cookie' }),
    isSessionCurrent: value => value === stamp, assertCaller: event => { if (event !== 'trusted') throw new Error('untrusted') },
    http: {
      async probe() { return { challenge: {} } },
      async getMetadata(url) { return { document: url.includes('oauth-protected-resource')
        ? { resource: binding.endpoint, authorization_servers: [issuer], scopes_supported: ['files:read'] } : metadata } },
      async register(request, options) { assert.equal(options.isCurrent(), true); options.beforeDispatch()
        return { ...JSON.parse(request.body), client_id: 'runtime-client' } },
      async exchange(request, options) {
        assert.equal(options.isCurrent(), true, 'both initial and refresh exchanges carry the exact live fence')
        options.beforeDispatch()
        const body = new URLSearchParams(request.body)
        if (body.get('grant_type') === 'refresh_token') { calls.refresh++; assert.equal(body.get('refresh_token'), 'runtime-refresh') }
        else { calls.exchange++; assert.equal(body.get('code'), 'runtime-code') }
        return { access_token: 'runtime-access', refresh_token: 'runtime-refresh', token_type: 'Bearer', scope: 'files:read' }
      },
      close() { calls.closed++ },
    },
    async openBrowser(raw) {
      calls.browser++
      const url = new URL(raw)
      const callback = new URL(url.searchParams.get('redirect_uri')!)
      callback.searchParams.set('state', url.searchParams.get('state')!)
      callback.searchParams.set('code', 'runtime-code')
      callback.searchParams.set('iss', issuer)
      assert.equal((await fetch(callback)).status, 200)
    },
    async fetch(_url, init) {
      if (init.method === 'POST') {
        calls.inspect++
        const request = JSON.parse(init.body)
        reference = request.credentialReference
        assert.equal((await vault.readOAuth(reference, binding, ownerUserId)).grant.accessToken, 'runtime-access')
        connection = { ...connection, revision: 1, status: 'connected', inspectionOperationId: request.operationId }
      }
      return new Response(JSON.stringify({ ownerUserId, binding, connection }), { headers: { 'Content-Type': 'application/json' } })
    },
  })
  return { vault, runtime, calls, get reference() { return reference }, switchAccount() { stamp = 'owner:2'; runtime.resetFlows() },
    async close() { runtime.close(); await rm(directory, { recursive: true, force: true }) } }
}

test('native composition completes reviewed sign-in, callback, custody, exact inspection and person-bound resolution', async () => {
  const f = await fixture()
  try {
    await assert.rejects(f.runtime.host.start('untrusted', { connectionId: binding.connectionId, expectedRevision: 0, source }))
    const started = await f.runtime.host.start('trusted', { connectionId: binding.connectionId, expectedRevision: 0, source })
    const reviewed = await f.runtime.host.review('trusted', { flowId: started.flowId, issuer })
    assert.deepEqual(reviewed.scopesSupported, ['files:read'])
    const result = await f.runtime.host.authorize('trusted', { flowId: started.flowId, scopes: ['files:read'] })
    assert.deepEqual(result, { status: 'complete', connection: { id: binding.connectionId, revision: 1, status: 'connected' } })
    assert.deepEqual(f.calls, { browser: 1, exchange: 1, refresh: 0, closed: 0, inspect: 1 })
    const resolveBinding = { ...binding, ownerUserId, connectionRevision: 1 }
    assert.equal(await f.runtime.resolveCredential(f.reference, resolveBinding, { isCurrent: () => true }), 'runtime-access')
    await assert.rejects(f.runtime.resolveCredential(f.reference, { ...resolveBinding, ownerUserId: 'other-person' }, { isCurrent: () => true }))
    f.switchAccount()
    assert.equal(await f.runtime.resolveCredential(f.reference, resolveBinding, { isCurrent: () => true }), 'runtime-access',
      'window switches do not rewrite the identity of already approved backend work')
    await assert.rejects(f.runtime.resolveCredential(f.reference, resolveBinding, { isCurrent: () => false }))
    assert.equal(JSON.stringify({ started, reviewed, result }).includes(f.reference), false)
  } finally { await f.close() }
})

test('account changes cancel old review handles; refresh keeps its dispatch fence and shutdown closes all native work', async () => {
  const f = await fixture()
  try {
    const started = await f.runtime.host.start('trusted', { connectionId: binding.connectionId, expectedRevision: 0, source })
    f.switchAccount()
    await assert.rejects(f.runtime.host.review('trusted', { flowId: started.flowId, issuer }))
    assert.equal(f.calls.browser, 0)
    const reference = await f.vault.provisionOAuth(binding, ownerUserId, { issuer, tokenEndpoint: metadata.token_endpoint,
      clientId: 'runtime-client', resource: binding.endpoint, scopes: ['files:read'], accessToken: 'expired-access',
      refreshToken: 'runtime-refresh', expiresAt: 1 })
    assert.equal(await f.runtime.resolveCredential(reference, { ...binding, ownerUserId, connectionRevision: 0 }, { isCurrent: () => true }), 'runtime-access')
    assert.equal(f.calls.refresh, 1)
    f.runtime.close()
    f.runtime.resetFlows()
    await assert.rejects(f.runtime.host.start('trusted', { connectionId: binding.connectionId, expectedRevision: 0, source }))
    await assert.rejects(f.runtime.resolveCredential(reference, { ...binding, ownerUserId, connectionRevision: 0 }, { isCurrent: () => true }))
    assert.equal(f.calls.closed, 1)
  } finally { await f.close() }
})
