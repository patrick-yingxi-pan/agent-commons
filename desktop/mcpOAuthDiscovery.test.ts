import { test } from 'node:test'
import assert from 'node:assert/strict'
import { McpOAuthHttpError } from './mcpOAuthHttp.mjs'
import { McpOAuthDiscoveryError, createMcpOAuthDiscovery } from './mcpOAuthDiscovery.mjs'
import { authorizationMetadataUrls, resourceMetadataUrls } from './mcpOAuthMetadata.mjs'

const endpoint = 'https://mcp.example.test/agent'
const resource = endpoint
const issuer = 'https://login.example.test/tenant'
const secondIssuer = 'https://accounts.example.test'
const resourceDocument = (extra: Record<string, unknown> = {}) => ({
  resource,
  authorization_servers: [issuer],
  scopes_supported: ['profile', 'files:read'],
  ...extra,
})
const resourceSnapshot = (extra: Record<string, unknown> = {}) => ({
  resource,
  authorizationServers: [issuer],
  scopesSupported: ['profile', 'files:read'],
  ...extra,
})
const serverDocument = (expectedIssuer = issuer, extra: Record<string, unknown> = {}) => ({
  issuer: expectedIssuer,
  authorization_endpoint: 'https://login.example.test/authorize',
  token_endpoint: 'https://login.example.test/token',
  response_types_supported: ['code'],
  grant_types_supported: ['authorization_code', 'refresh_token'],
  token_endpoint_auth_methods_supported: ['none'],
  code_challenge_methods_supported: ['S256'],
  ...extra,
})
const options = (extra: Record<string, unknown> = {}) => ({ isCurrent: () => true, ...extra })
const discoveryError = (error: unknown) => error instanceof McpOAuthDiscoveryError && error.message === 'OAuth discovery could not be completed.'
const httpError = (code: string) => (error: unknown) => error instanceof McpOAuthHttpError && error.code === code

function fixture({ probe = { status: 401, challenge: {} }, onProbe, getMetadata }: {
  probe?: { status: number; challenge: Record<string, unknown> }
  onProbe?: () => Promise<void> | void
  getMetadata?: (url: string, options: Record<string, unknown>) => Promise<{ document: unknown }>
} = {}) {
  const probes: Array<{ endpoint: string; options: Record<string, unknown> }> = []
  const gets: Array<{ url: string; options: Record<string, unknown> }> = []
  const http = {
    async probe(target: string, requestOptions: Record<string, unknown>) {
      probes.push({ endpoint: target, options: requestOptions })
      await onProbe?.()
      return probe
    },
    async getMetadata(url: string, requestOptions: Record<string, unknown>) {
      gets.push({ url, options: requestOptions })
      if (!getMetadata) throw new Error('No fixture document')
      return getMetadata(url, requestOptions)
    },
  }
  return { discovery: createMcpOAuthDiscovery({ http }), probes, gets }
}

test('advertised resource_metadata URL is preferred exclusively, with no well-known fallback', async () => {
  const advertised = 'https://metadata.example.test/protected-resource'
  const harness = fixture({
    probe: { status: 401, challenge: { resourceMetadataUrl: advertised } },
    getMetadata: async () => { throw new McpOAuthHttpError('http', false, 404) },
  })
  await assert.rejects(harness.discovery.discoverResource(endpoint, options()), discoveryError)
  assert.deepEqual(harness.gets.map(item => item.url), [advertised])
  assert.equal(harness.probes[0].endpoint, endpoint)
})

test('only 404 and 410 advance through standards-ordered resource and authorization metadata URLs', async () => {
  const resourceUrls = resourceMetadataUrls(endpoint)
  const resourceHarness = fixture({ getMetadata: async url => {
    if (url === resourceUrls[0]) throw new McpOAuthHttpError('http', false, 404)
    return { document: resourceDocument() }
  } })
  const foundResource = await resourceHarness.discovery.discoverResource(endpoint, options())
  assert.equal(foundResource.resource, resource)
  assert.deepEqual(resourceHarness.gets.map(item => item.url), resourceUrls)

  const serverUrls = authorizationMetadataUrls(issuer)
  const serverHarness = fixture({ getMetadata: async url => {
    if (url === serverUrls[0]) throw new McpOAuthHttpError('http', false, 404)
    if (url === serverUrls[1]) throw new McpOAuthHttpError('http', false, 410)
    return { document: serverDocument() }
  } })
  const server = await serverHarness.discovery.discoverServer(resourceSnapshot(), issuer, options())
  assert.equal(server.issuer, issuer)
  assert.deepEqual(serverHarness.gets.map(item => item.url), serverUrls)
})

test('exact resource and issuer identity failures are terminal and do not try another URL', async () => {
  const urls = resourceMetadataUrls(endpoint)
  const aliasHarness = fixture({ getMetadata: async () => ({ document: resourceDocument({ resource: 'https://mcp.example.test/x/../agent' }) }) })
  await assert.rejects(aliasHarness.discovery.discoverResource(endpoint, options()), discoveryError)
  assert.deepEqual(aliasHarness.gets.map(item => item.url), [urls[0]])

  const serverUrls = authorizationMetadataUrls(issuer)
  const mismatchHarness = fixture({ getMetadata: async () => ({ document: serverDocument('https://LOGIN.example.test/tenant') }) })
  await assert.rejects(mismatchHarness.discovery.discoverServer(resourceSnapshot(), issuer, options()), discoveryError)
  assert.deepEqual(mismatchHarness.gets.map(item => item.url), [serverUrls[0]])
})

test('server discovery refuses an unadvertised issuer before metadata I/O', async () => {
  const harness = fixture({ getMetadata: async () => ({ document: serverDocument(secondIssuer) }) })
  await assert.rejects(harness.discovery.discoverServer(resourceSnapshot(), secondIssuer, options()), discoveryError)
  assert.deepEqual(harness.gets, [])
})

test('multiple advertised issuers stay a selection list; discovery never registers a client', async () => {
  const harness = fixture({ getMetadata: async url => {
    if (url === resourceMetadataUrls(endpoint)[0]) return { document: resourceDocument({ authorization_servers: [issuer, secondIssuer] }) }
    return { document: serverDocument(secondIssuer, { registration_endpoint: 'https://accounts.example.test/register' }) }
  } })
  const resourceResult = await harness.discovery.discoverResource(endpoint, options())
  assert.deepEqual(resourceResult.authorizationServers, [issuer, secondIssuer])
  assert.deepEqual(harness.gets.map(item => item.url), [resourceMetadataUrls(endpoint)[0]])

  const chosen = await harness.discovery.discoverServer(resourceResult, secondIssuer, options())
  assert.equal(chosen.issuer, secondIssuer)
  assert.equal(chosen.registrationEndpoint, 'https://accounts.example.test/register')
  assert.deepEqual(harness.gets.slice(1).map(item => item.url), [authorizationMetadataUrls(secondIssuer)[0]])
  assert.ok(harness.gets.every(item => !item.url.endsWith('/register')))
})

test('challenge scopes remain separate from resource-supported scopes and are detached', async () => {
  const challengeScopes = ['challenge:read']
  const harness = fixture({
    probe: { status: 401, challenge: { scopes: challengeScopes } },
    getMetadata: async () => ({ document: resourceDocument() }),
  })
  const result = await harness.discovery.discoverResource(endpoint, options())
  challengeScopes.push('later:write')
  assert.deepEqual(result.challengeScopes, ['challenge:read'])
  assert.deepEqual(result.scopesSupported, ['profile', 'files:read'])
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.challengeScopes) && Object.isFrozen(result.scopesSupported))
})

test('current, cancellation and one staged deadline are rechecked between probe and metadata fetch', async () => {
  let current = true
  const staleHarness = fixture({
    onProbe: () => { current = false },
    getMetadata: async () => ({ document: resourceDocument() }),
  })
  await assert.rejects(staleHarness.discovery.discoverResource(endpoint, options({ isCurrent: () => current })), httpError('stale'))
  assert.deepEqual(staleHarness.gets, [])

  const controller = new AbortController()
  const cancelledHarness = fixture({
    onProbe: () => controller.abort(),
    getMetadata: async () => ({ document: resourceDocument() }),
  })
  await assert.rejects(cancelledHarness.discovery.discoverResource(endpoint, options({ signal: controller.signal })), httpError('cancelled'))
  assert.deepEqual(cancelledHarness.gets, [])

  const timeoutHarness = fixture({
    onProbe: () => new Promise(resolve => setTimeout(resolve, 5)),
    getMetadata: async () => ({ document: resourceDocument() }),
  })
  await assert.rejects(timeoutHarness.discovery.discoverResource(endpoint, options({ timeoutMs: 1 })), httpError('timeout'))

  current = true
  const publishFenceHarness = fixture({ getMetadata: async () => {
    current = false
    return { document: resourceDocument() }
  } })
  await assert.rejects(publishFenceHarness.discovery.discoverResource(endpoint, options({ isCurrent: () => current })), httpError('stale'))
})

test('hard transport failures do not downgrade, and unexpected errors are not reflected', async () => {
  for (const failure of [
    new McpOAuthHttpError('redirect', false, 302),
    new McpOAuthHttpError('network'),
    new McpOAuthHttpError('response'),
    new McpOAuthHttpError('http', false, 500),
  ]) {
    const harness = fixture({ getMetadata: async () => { throw failure } })
    await assert.rejects(harness.discovery.discoverResource(endpoint, options()), error => error === failure)
    assert.equal(harness.gets.length, 1)
  }
  const canary = 'untrusted-provider-detail-canary'
  const unexpected = fixture({ getMetadata: async () => { throw new Error(canary) } })
  await assert.rejects(unexpected.discovery.discoverResource(endpoint, options()), error =>
    discoveryError(error) && !error.message.includes(canary))
})
