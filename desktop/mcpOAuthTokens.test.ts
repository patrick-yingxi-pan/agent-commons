import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMcpOAuthRefreshRequest, parseMcpOAuthTokenResponse, McpOAuthTokenError } from './mcpOAuthTokens.mjs'

const response = () => ({ access_token: 'access.secret', token_type: 'Bearer', expires_in: 3600, scope: 'read offline_access', refresh_token: 'refresh.secret' })
const options = () => ({ reviewedScopes: ['read', 'offline_access'], now: 1000 })

test('token parser preserves only bounded native credentials, granted subset, and explicit expiry', () => {
  const raw = { ...response(), id_token: 'not-an-identity-proof', arbitrary: 'ignored' }
  const parsed = parseMcpOAuthTokenResponse(raw, options())
  assert.deepEqual(parsed, { accessToken: 'access.secret', refreshToken: 'refresh.secret', scopes: ['read', 'offline_access'], expiresAt: 3601000 })
  assert.ok(Object.isFrozen(parsed)); assert.ok(Object.isFrozen(parsed.scopes))
  raw.access_token = 'changed'
  assert.equal(parsed.accessToken, 'access.secret')
  assert.deepEqual(parseMcpOAuthTokenResponse({ access_token: 'fresh', token_type: 'bearer' }, options()), {
    accessToken: 'fresh', scopes: ['read', 'offline_access'], expiresAt: null,
  })
  assert.deepEqual(parseMcpOAuthTokenResponse({ ...response(), scope: 'read', expires_in: 0 }, options()).scopes, ['read'])
  assert.equal(parseMcpOAuthTokenResponse({ ...response(), expires_in: 0 }, options()).expiresAt, 1000)
})

test('refresh response may rotate or retain the prior secret but cannot expand scope', () => {
  const opts = { ...options(), previousRefreshToken: 'prior.refresh' }
  assert.equal(parseMcpOAuthTokenResponse(response(), opts).refreshToken, 'refresh.secret')
  assert.equal(parseMcpOAuthTokenResponse({ access_token: 'new', token_type: 'Bearer' }, opts).refreshToken, 'prior.refresh')
  for (const scope of ['read write', 'admin', 'read  offline_access', '', 'read read', 'read\nadmin']) {
    assert.throws(() => parseMcpOAuthTokenResponse({ ...response(), scope }, opts), McpOAuthTokenError)
  }
})

test('malformed, excessive, unsupported and error-bearing token replies fail without secrets in errors', () => {
  for (const change of [
    { access_token: '' }, { access_token: 'x'.repeat(8193) }, { access_token: 'secret\nvalue' },
    { token_type: 'MAC' }, { token_type: null }, { refresh_token: '' }, { refresh_token: null },
    { expires_in: '3600' }, { expires_in: -1 }, { expires_in: Infinity }, { expires_in: Number.MAX_SAFE_INTEGER },
    { expires_in: 0.5 }, { error: 'invalid_grant', error_description: 'PRIVATE WORDS' }, { scope: ['read'] },
  ]) assert.throws(() => parseMcpOAuthTokenResponse({ ...response(), ...change }, options()), error => error instanceof McpOAuthTokenError && !/secret|PRIVATE/.test(error.message))
  let calls = 0
  const hostile = { ...response(), get surprise() { calls++; throw new Error('PRIVATE WORDS') } }
  assert.throws(() => parseMcpOAuthTokenResponse(hostile, options()), McpOAuthTokenError)
  assert.equal(calls, 0)
  for (const now of [-1, NaN, Number.MAX_SAFE_INTEGER]) assert.throws(() => parseMcpOAuthTokenResponse(response(), { ...options(), now }), McpOAuthTokenError)
})

test('refresh form remains bound to its issuer/client/resource and exact granted scopes', () => {
  const grant = { issuer: 'https://auth.example/issuer', tokenEndpoint: 'https://auth.example/token', clientId: 'client', resource: 'https://mcp.example/path', scopes: ['read'], refreshToken: 'private.refresh' }
  const request = createMcpOAuthRefreshRequest(grant)
  grant.scopes.push('write')
  assert.equal(request.issuer, grant.issuer)
  assert.equal(request.endpoint, grant.tokenEndpoint)
  assert.deepEqual(Object.fromEntries(new URLSearchParams(request.body)), {
    grant_type: 'refresh_token', refresh_token: 'private.refresh', client_id: 'client', resource: grant.resource, scope: 'read',
  })
  assert.deepEqual(request.scopes, ['read'])
  for (const bad of [
    { ...grant, issuer: 'https://auth.example/issuer?query=1' },
    { ...grant, tokenEndpoint: 'http://auth.example/token' },
    { ...grant, resource: 'https://mcp.example/#fragment' },
    { ...grant, refreshToken: '' }, { ...grant, clientId: '' }, { ...grant, scopes: ['bad scope'] },
  ]) assert.throws(() => createMcpOAuthRefreshRequest(bad), McpOAuthTokenError)
})
