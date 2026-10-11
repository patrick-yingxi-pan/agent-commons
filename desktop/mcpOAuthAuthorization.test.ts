import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createMcpOAuthAuthorization, McpOAuthAuthorizationError } from './mcpOAuthAuthorization.mjs'

const issuer = 'https://auth.example/tenant'
const metadata = {
  issuer, authorization_endpoint: `${issuer}/authorize?tenant=one`, token_endpoint: `${issuer}/token`,
  response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'],
  code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'],
  authorization_response_iss_parameter_supported: true, scopes_supported: ['read', 'offline_access'],
}
const parameters = () => ({
  issuer, metadata: { ...metadata }, resource: 'https://mcp.example/mcp', clientId: 'native-client',
  redirectUri: 'http://127.0.0.1:49152/oauth/callback', scopes: ['read', 'offline_access'],
})
const callback = (attempt, extra = {}) => `${attempt.redirectUri}?${new URLSearchParams({
  state: new URL(attempt.authorizationUrl).searchParams.get('state')!, iss: issuer, code: 'one-code', ...extra,
})}`
const codeIs = code => error => error instanceof McpOAuthAuthorizationError && error.code === code && !error.message.includes('one-code')

test('opaque authorization codes and client IDs retain OAuth VSCHAR spaces through form encoding', () => {
  const attempt = createMcpOAuthAuthorization({ ...parameters(), clientId: ' native client ' })
  assert.equal(new URL(attempt.authorizationUrl).searchParams.get('client_id'), ' native client ')
  const form = new URLSearchParams(attempt.receiveCallback(callback(attempt, { code: ' opaque code ' })).body)
  assert.equal(form.get('client_id'), ' native client ')
  assert.equal(form.get('code'), ' opaque code ')
})

test('native OAuth creates independent S256 state/PKCE and audience-bound one-use token form', () => {
  const input = parameters()
  const attempt = createMcpOAuthAuthorization(input)
  const second = createMcpOAuthAuthorization(input)
  const query = new URL(attempt.authorizationUrl).searchParams
  assert.equal(query.get('tenant'), 'one')
  assert.equal(query.get('response_type'), 'code')
  assert.equal(query.get('scope'), 'read offline_access')
  assert.equal(query.get('resource'), input.resource)
  assert.equal(query.get('redirect_uri'), input.redirectUri)
  assert.equal(query.get('code_challenge_method'), 'S256')
  assert.match(query.get('state')!, /^[A-Za-z0-9_-]{43}$/)
  assert.notEqual(query.get('state'), new URL(second.authorizationUrl).searchParams.get('state'))
  assert.equal(query.has('code_verifier'), false)
  input.scopes.push('write')
  input.metadata.token_endpoint = 'https://changed.example/token'
  const result = attempt.receiveCallback(callback(attempt, { extension: 'ignored' }))
  const form = new URLSearchParams(result.body)
  assert.equal(result.endpoint, metadata.token_endpoint)
  assert.equal(form.get('client_id'), 'native-client')
  assert.equal(form.get('grant_type'), 'authorization_code')
  assert.equal(form.get('code'), 'one-code')
  assert.equal(form.get('resource'), input.resource)
  assert.equal(form.get('scope'), 'read offline_access')
  assert.equal(form.get('redirect_uri'), input.redirectUri)
  assert.equal(createHash('sha256').update(form.get('code_verifier')!).digest('base64url'), query.get('code_challenge'))
  assert.notEqual(form.get('code_verifier'), query.get('state'))
  assert.deepEqual(result.scopes, ['read', 'offline_access'])
  assert.ok(Object.isFrozen(result.scopes))
  assert.throws(() => attempt.receiveCallback(callback(attempt)), codeIs('used'))
})

test('scope omissions and challenged scopes do not invent offline access or require metadata set membership', () => {
  for (const scopes of [[], ['server:dynamic-operation']]) {
    const attempt = createMcpOAuthAuthorization({ ...parameters(), scopes })
    const query = new URL(attempt.authorizationUrl).searchParams
    assert.equal(query.get('scope'), scopes.length ? scopes.join(' ') : null)
    const result = new URLSearchParams(attempt.receiveCallback(callback(attempt)).body)
    assert.equal(result.get('scope'), query.get('scope'))
  }
  assert.throws(() => createMcpOAuthAuthorization({ ...parameters(), metadata: { ...metadata, scopes_supported: ['read'] } }), codeIs('request'))
})

test('unknown callbacks, wrong state, invalid encoding and ambiguous parameters cannot consume a valid attempt', () => {
  const attempt = createMcpOAuthAuthorization(parameters())
  const valid = callback(attempt)
  for (const invalid of [
    valid.replace('127.0.0.1', 'localhost'), valid.replace('/oauth/callback?', '/oauth/%63allback?'),
    `${valid}#fragment`, `${valid}&code=two`, `${valid}&state=two`, `${valid}&iss=${encodeURIComponent(issuer)}`,
    `${valid}&error_description=a&error_description=b`, `${valid}&extra=%GG`, `${valid}&extra=%FF`,
    `${valid}&extra=${'x'.repeat(16_384)}`,
  ]) {
    assert.throws(() => attempt.receiveCallback(invalid), codeIs('request'))
  }
  for (const state of ['', 'wrong', 'é'.repeat(43)]) {
    assert.throws(() => attempt.receiveCallback(callback(attempt, { state })), codeIs('state'))
  }
  assert.equal(new URLSearchParams(attempt.receiveCallback(valid).body).get('code'), 'one-code')
})

test('issuer is compared exactly before either success or remote denial can be accepted', () => {
  for (const advertised of [true, false]) {
    for (const mismatch of ['https://AUTH.example/tenant', `${issuer}/`, 'https://auth.example:443/tenant', `${issuer}%2F`]) {
      for (const denial of [false, true]) {
        const attempt = createMcpOAuthAuthorization({ ...parameters(), metadata: { ...metadata, authorization_response_iss_parameter_supported: advertised } })
        const url = new URL(callback(attempt, { iss: mismatch }))
        if (denial) { url.searchParams.delete('code'); url.searchParams.set('error', 'DO-NOT-REFLECT'); url.searchParams.set('error_description', 'private provider words') }
        assert.throws(() => attempt.receiveCallback(url.href), error => codeIs('issuer')(error) && !error.message.includes('private provider'))
        assert.throws(() => attempt.receiveCallback(callback(attempt)), codeIs('used'))
      }
    }
    const attempt = createMcpOAuthAuthorization({ ...parameters(), metadata: { ...metadata, authorization_response_iss_parameter_supported: advertised } })
    const url = new URL(callback(attempt)); url.searchParams.delete('iss')
    if (advertised) assert.throws(() => attempt.receiveCallback(url.href), codeIs('issuer'))
    else assert.ok(attempt.receiveCallback(url.href))
  }
})

test('denial and malformed authenticated responses are terminal without upstream error reflection', () => {
  for (const [values, failure] of [[{ error: 'access_denied', code: undefined }, 'denied'], [{ error: 'x', code: 'also-code' }, 'response'], [{ code: '' }, 'response'], [{ code: 'a\nb' }, 'response']]) {
    const attempt = createMcpOAuthAuthorization(parameters())
    const url = new URL(callback(attempt))
    for (const [key, value] of Object.entries(values)) value === undefined ? url.searchParams.delete(key) : url.searchParams.set(key, value)
    url.searchParams.set('error_description', 'private provider words')
    assert.throws(() => attempt.receiveCallback(url.href), error => codeIs(failure)(error) && !error.message.includes('private provider'))
    assert.throws(() => attempt.receiveCallback(callback(attempt)), codeIs('used'))
  }
})

test('expiry, backwards clock and cancellation never release a code twice', () => {
  for (const end of [110, 99, NaN]) {
    let time = 100
    const attempt = createMcpOAuthAuthorization(parameters(), { now: () => time, timeoutMs: 10 })
    time = end
    assert.throws(() => attempt.receiveCallback(callback(attempt)), codeIs('expired'))
    assert.throws(() => attempt.receiveCallback(callback(attempt)), codeIs('used'))
  }
  const attempt = createMcpOAuthAuthorization(parameters())
  attempt.cancel(); attempt.cancel()
  assert.throws(() => attempt.receiveCallback(callback(attempt)), codeIs('used'))
})

test('invalid client, redirect, resource, entropy and endpoint parameter collisions refuse before authorization', () => {
  for (const redirectUri of ['http://localhost:49152/oauth/callback', 'http://127.0.0.1/oauth/callback', 'http://127.0.0.1:49152/other', 'https://example.com/oauth/callback', 'http://127.0.0.1:49152/oauth/callback#', 'http://127.0.0.1:49152/oauth/callback?x=y']) {
    assert.throws(() => createMcpOAuthAuthorization({ ...parameters(), redirectUri }), codeIs('request'))
  }
  for (const resource of ['http://mcp.example/mcp', 'https://user:secret@mcp.example/mcp', 'https://mcp.example/#']) {
    assert.throws(() => createMcpOAuthAuthorization({ ...parameters(), resource }), codeIs('request'))
  }
  for (const clientId of ['', 'bad\nclient', 'x'.repeat(2049)]) assert.throws(() => createMcpOAuthAuthorization({ ...parameters(), clientId }), codeIs('request'))
  for (const key of ['response_type', 'client_id', 'redirect_uri', 'scope', 'state', 'resource', 'code_challenge', 'code_challenge_method', 'response_mode']) {
    assert.throws(() => createMcpOAuthAuthorization({ ...parameters(), metadata: { ...metadata, authorization_endpoint: `${issuer}/authorize?${key}=unreviewed` } }), codeIs('request'))
  }
  for (const timeoutMs of [0, 180_001, NaN]) assert.throws(() => createMcpOAuthAuthorization(parameters(), { timeoutMs }), codeIs('request'))
  assert.throws(() => createMcpOAuthAuthorization(parameters(), { random: () => Buffer.alloc(31) }), codeIs('request'))
})
