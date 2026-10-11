import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createMcpOAuthRegistrationRequest,
  McpOAuthRegistrationError,
  parseMcpOAuthRegistrationResponse,
  registerMcpOAuthClient,
  snapshotMcpOAuthClientConfiguration,
  selectMcpOAuthClient,
} from './mcpOAuthRegistration.mjs'

const issuer = 'https://login.example.test/tenant'
const endpoint = 'https://login.example.test/register'
const redirectUri = 'http://127.0.0.1:49152/oauth/callback'
const serverMetadata = (extra: Record<string, unknown> = {}) => ({
  issuer,
  authorization_endpoint: `${issuer}/authorize`,
  token_endpoint: `${issuer}/token`,
  response_types_supported: ['code'],
  grant_types_supported: ['authorization_code'],
  token_endpoint_auth_methods_supported: ['none'],
  code_challenge_methods_supported: ['S256'],
  ...extra,
})
const request = (extra: Record<string, unknown> = {}) => createMcpOAuthRegistrationRequest({
  endpoint, redirectUri, scopes: ['records:read'], refresh: true, ...extra,
})
const response = (extra: Record<string, unknown> = {}) => ({
  client_id: 'registered-native-client',
  application_type: 'native',
  token_endpoint_auth_method: 'none',
  redirect_uris: [redirectUri],
  response_types: ['code'],
  grant_types: ['authorization_code', 'refresh_token'],
  scope: 'records:read',
  ...extra,
})
const options = (extra: Record<string, unknown> = {}) => ({ isCurrent: () => true, ...extra })
const registrationError = (code?: string, mayHaveRegistered?: boolean) => (error: unknown) => {
  assert.ok(error instanceof McpOAuthRegistrationError)
  if (code !== undefined) assert.equal(error.code, code)
  if (mayHaveRegistered !== undefined) assert.equal(error.mayHaveRegistered, mayHaveRegistered)
  assert.doesNotMatch(error.message, /private|management|secret-canary|remote detail/)
  return true
}

test('operator client configuration is closed, bounded, detached and never invokes getters', () => {
  const raw = {
    preRegistered: [{ issuer, clientId: 'native-client' }],
    clientMetadataUrl: 'https://client.example.test/commons.json',
  }
  const config = snapshotMcpOAuthClientConfiguration(raw)
  raw.preRegistered[0].clientId = 'changed'
  assert.deepEqual(config, {
    preRegistered: [{ issuer, clientId: 'native-client' }],
    clientMetadataUrl: 'https://client.example.test/commons.json',
  })
  assert.ok(Object.isFrozen(config) && Object.isFrozen(config.preRegistered) && Object.isFrozen(config.preRegistered[0]))

  let reads = 0
  const accessor = {}
  Object.defineProperty(accessor, 'clientMetadataUrl', { enumerable: true, get() { reads++; return 'https://evil.example/client.json' } })
  assert.throws(() => snapshotMcpOAuthClientConfiguration(accessor), registrationError('configuration'))
  assert.equal(reads, 0)
  for (const invalid of [
    { extra: true }, { preRegistered: Array(65).fill({ issuer, clientId: 'id' }) },
    { preRegistered: [{ issuer, clientId: 'id' }, { issuer, clientId: 'another' }] },
    { preRegistered: [{ issuer, clientId: 'bad\nclient' }] },
    { clientMetadataUrl: 'https://client.example.test/' },
    { clientMetadataUrl: 'http://client.example.test/client.json' },
    { clientMetadataUrl: 'https://127.0.0.1/client.json' },
    { clientMetadataUrl: 'https://user:pass@client.example.test/client.json' },
  ]) assert.throws(() => snapshotMcpOAuthClientConfiguration(invalid), registrationError('configuration'))
})

test('client method priority is exact-issuer pre-registration, configured CIMD, then advertised DCR', () => {
  const metadata = serverMetadata({ registration_endpoint: endpoint,
    client_id_metadata_document_supported: true, grant_types_supported: ['authorization_code', 'refresh_token'] })
  const known = selectMcpOAuthClient({ issuer, metadata, configuration: {
    preRegistered: [{ issuer: 'https://other.example', clientId: 'wrong-issuer-client' }, { issuer, clientId: 'known-client' }],
    clientMetadataUrl: 'https://client.example.test/metadata.json',
  } })
  assert.deepEqual(known, { method: 'pre-registered', issuer, clientId: 'known-client' })

  const cimd = selectMcpOAuthClient({ issuer, metadata, configuration: { clientMetadataUrl: 'https://client.example.test/metadata.json' } })
  assert.deepEqual(cimd, { method: 'metadata', issuer, clientId: 'https://client.example.test/metadata.json' })

  const dcr = selectMcpOAuthClient({ issuer, metadata, configuration: {} })
  assert.deepEqual(dcr, { method: 'dynamic', issuer, endpoint, refresh: true })
  assert.deepEqual(selectMcpOAuthClient({ issuer, metadata: serverMetadata({ registration_endpoint: endpoint }), configuration: {} }),
    { method: 'dynamic', issuer, endpoint, refresh: false })
})

test('selection requires explicit issuer capability/configuration and never invents a client URL', () => {
  assert.throws(() => selectMcpOAuthClient({ issuer, metadata: serverMetadata(), configuration: {} }), registrationError('client-required'))
  assert.throws(() => selectMcpOAuthClient({ issuer,
    metadata: serverMetadata({ client_id_metadata_document_supported: true }), configuration: {} }), registrationError('client-required'))
  assert.deepEqual(selectMcpOAuthClient({ issuer,
    metadata: serverMetadata({ registration_endpoint: endpoint, client_id_metadata_document_supported: false }),
    configuration: { clientMetadataUrl: 'https://client.example.test/metadata.json' } }),
  { method: 'dynamic', issuer, endpoint, refresh: false })
  const otherIssuer = 'https://other.example'
  assert.throws(() => selectMcpOAuthClient({ issuer: otherIssuer, metadata: serverMetadata({ issuer: otherIssuer,
    authorization_endpoint: `${otherIssuer}/authorize`, token_endpoint: `${otherIssuer}/token` }),
    configuration: { preRegistered: [{ issuer, clientId: 'issuer-scoped-client' }] } }), registrationError('client-required'))
  assert.throws(() => selectMcpOAuthClient({ issuer, metadata: serverMetadata({ issuer: 'https://other.example' }), configuration: {} }),
    registrationError('request'))
})

test('registration request is a closed public-native code form with reviewed redirect/scopes and optional refresh', () => {
  const value = request()
  assert.deepEqual(value, {
    endpoint, redirectUri, scopes: ['records:read'], refresh: true,
    body: JSON.stringify({ client_name: 'Agent Commons', application_type: 'native', redirect_uris: [redirectUri],
      token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], scope: 'records:read' }),
  })
  assert.ok(Object.isFrozen(value) && Object.isFrozen(value.scopes))
  const noScopeNoRefresh = request({ scopes: [], refresh: false })
  assert.deepEqual(JSON.parse(noScopeNoRefresh.body).grant_types, ['authorization_code'])
  assert.equal(Object.hasOwn(JSON.parse(noScopeNoRefresh.body), 'scope'), false)
  for (const invalid of [
    { extra: true }, { endpoint: 'http://login.example.test/register' },
    { redirectUri: 'http://localhost:49152/oauth/callback' }, { redirectUri: 'http://127.0.0.1:49152/other' },
    { scopes: ['records:read', 'records:read'] }, { scopes: ['bad scope'] }, { refresh: 'yes' },
  ]) assert.throws(() => request(invalid), registrationError('request'))
})

test('DCR response requires exact public-native grant/redirect semantics and refuses secrets', () => {
  const prepared = request()
  assert.equal(parseMcpOAuthRegistrationResponse(response(), prepared), 'registered-native-client')
  for (const invalid of [
    response({ client_id: '' }), response({ token_endpoint_auth_method: 'client_secret_basic' }),
    response({ application_type: 'web' }), response({ client_secret: 'secret-canary' }),
    response({ client_secret_expires_at: 0 }), response({ redirect_uris: ['https://attacker.example/callback'] }),
    response({ redirect_uris: [redirectUri, 'https://attacker.example/callback'] }),
    response({ response_types: ['token'] }), response({ grant_types: ['authorization_code', 'password'] }),
    response({ grant_types: ['authorization_code'] }), response({ scope: 'records:write' }),
  ]) assert.throws(() => parseMcpOAuthRegistrationResponse(invalid, prepared), registrationError('response'))
  assert.throws(() => parseMcpOAuthRegistrationResponse(response({ grant_types: ['authorization_code', 'refresh_token'] }), request({ refresh: false })),
    registrationError('response'))

  let reads = 0
  const hostile = response()
  Object.defineProperty(hostile, 'client_id', { enumerable: true, get() { reads++; return 'wrong' } })
  assert.throws(() => parseMcpOAuthRegistrationResponse(hostile, prepared), registrationError('response'))
  assert.equal(reads, 0)
})

test('DCR output retains only the client ID, never registration-management credentials', async () => {
  const plan = { method: 'dynamic', issuer, endpoint, refresh: true }
  let calls = 0
  const result = await registerMcpOAuthClient({ http: { async register(prepared, { beforeDispatch }) {
    calls++
    beforeDispatch()
    return response({ registration_client_uri: 'https://login.example.test/manage/private',
      registration_access_token: 'management-secret-canary', extra_server_field: 'ignored' })
  } }, plan, redirectUri, scopes: ['records:read'] }, options())
  assert.deepEqual(result, { clientId: 'registered-native-client', method: 'dynamic' })
  assert.equal(JSON.stringify(result).includes('management-secret-canary'), false)
  assert.equal(calls, 1)
})

test('pre-registered and configured metadata choices return without network registration', async () => {
  for (const plan of [
    { method: 'pre-registered', issuer, clientId: 'configured-client' },
    { method: 'metadata', issuer, clientId: 'https://client.example.test/metadata.json' },
  ]) {
    const result = await registerMcpOAuthClient({ http: undefined, plan, redirectUri, scopes: [] }, options())
    assert.deepEqual(result, { clientId: plan.clientId, method: plan.method })
  }
})

test('DCR dispatches once, fences stale/cancelled work, and reports uncertain submission without retry', async () => {
  const plan = { method: 'dynamic', issuer, endpoint, refresh: false }
  let calls = 0
  const preDispatch = { async register(_prepared, { beforeDispatch }) { calls++; beforeDispatch(); return response({ grant_types: ['authorization_code'] }) } }
  assert.deepEqual(await registerMcpOAuthClient({ http: preDispatch, plan, redirectUri, scopes: [] }, options()),
    { clientId: 'registered-native-client', method: 'dynamic' })
  assert.equal(calls, 1)

  calls = 0
  await assert.rejects(registerMcpOAuthClient({ http: preDispatch, plan, redirectUri, scopes: [] }, options({ isCurrent: () => false })),
    registrationError('stale', false))
  assert.equal(calls, 0)
  const aborted = new AbortController(); aborted.abort()
  await assert.rejects(registerMcpOAuthClient({ http: preDispatch, plan, redirectUri, scopes: [] }, options({ signal: aborted.signal })),
    registrationError('cancelled', false))
  assert.equal(calls, 0)

  const uncertain = { async register(_prepared, { beforeDispatch }) { calls++; beforeDispatch(); throw new Error('remote detail') } }
  await assert.rejects(registerMcpOAuthClient({ http: uncertain, plan, redirectUri, scopes: [] }, options()),
    registrationError('unavailable', true))
  assert.equal(calls, 1)

  let resolveLate!: (value: unknown) => void
  const gate = new Promise(resolve => { resolveLate = resolve })
  let current = true
  const late = { async register(_prepared, { beforeDispatch }) { calls++; beforeDispatch(); return gate } }
  const lateResult = registerMcpOAuthClient({ http: late, plan, redirectUri, scopes: [] }, options({ isCurrent: () => current }))
  current = false
  resolveLate(response({ grant_types: ['authorization_code'] }))
  await assert.rejects(lateResult, registrationError('stale', true))
})
