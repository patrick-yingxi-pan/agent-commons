import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  OAuthMetadataError,
  authorizationMetadataUrls,
  oauthHttpsUrl,
  oauthResourceUrl,
  oauthScopes,
  parseOAuthResourceMetadata,
  parseOAuthServerMetadata,
  resourceMetadataUrls,
  snapshotOAuthJson,
} from './mcpOAuthMetadata.mjs'

const issuer = 'https://login.example.test/tenant-a'
const resource = 'https://mcp.example.test/agent'
const serverMetadata = (extra: Record<string, unknown> = {}) => ({
  issuer,
  authorization_endpoint: 'https://login.example.test/authorize',
  token_endpoint: 'https://login.example.test/token',
  response_types_supported: ['code'],
  grant_types_supported: ['authorization_code', 'refresh_token'],
  token_endpoint_auth_methods_supported: ['none'],
  code_challenge_methods_supported: ['S256'],
  ...extra,
})

function metadataError(fn: () => unknown, code = 'invalid') {
  assert.throws(fn, (error: unknown) => error instanceof OAuthMetadataError && error.code === code)
}

test('well-known URL candidates follow RFC path insertion and preserve distinct ordering', () => {
  assert.deepEqual(resourceMetadataUrls(resource), [
    'https://mcp.example.test/.well-known/oauth-protected-resource/agent',
    'https://mcp.example.test/.well-known/oauth-protected-resource',
  ])
  assert.deepEqual(resourceMetadataUrls('https://mcp.example.test/'), [
    'https://mcp.example.test/.well-known/oauth-protected-resource',
  ])
  assert.deepEqual(resourceMetadataUrls('https://mcp.example.test/agent?region=one'), [
    'https://mcp.example.test/.well-known/oauth-protected-resource/agent?region=one',
    'https://mcp.example.test/.well-known/oauth-protected-resource',
  ])
  assert.equal(oauthResourceUrl('HTTPS://MCP.EXAMPLE.TEST:443/'), 'https://mcp.example.test')
  assert.equal(oauthResourceUrl('HTTPS://MCP.EXAMPLE.TEST:443/agent'), resource)
  assert.deepEqual(resourceMetadataUrls('https://mcp.example.test/agent/'), [
    'https://mcp.example.test/.well-known/oauth-protected-resource/agent',
    'https://mcp.example.test/.well-known/oauth-protected-resource',
  ])
  assert.deepEqual(authorizationMetadataUrls(issuer), [
    'https://login.example.test/.well-known/oauth-authorization-server/tenant-a',
    'https://login.example.test/.well-known/openid-configuration/tenant-a',
    'https://login.example.test/tenant-a/.well-known/openid-configuration',
  ])
  assert.deepEqual(authorizationMetadataUrls('https://login.example.test'), [
    'https://login.example.test/.well-known/oauth-authorization-server',
    'https://login.example.test/.well-known/openid-configuration',
  ])
  for (const urls of [resourceMetadataUrls(resource), authorizationMetadataUrls(issuer)]) {
    assert.equal(new Set(urls).size, urls.length)
    assert.ok(Object.isFrozen(urls))
  }
})

test('OAuth metadata snapshots plain bounded JSON without invoking accessors or toJSON', () => {
  let getterCalls = 0
  let toJsonCalls = 0
  const raw = { issuer }
  Object.defineProperty(raw, 'authorization_endpoint', { enumerable: true, get() { getterCalls += 1; return 'https://x.test/auth' } })
  metadataError(() => snapshotOAuthJson(raw))
  assert.equal(getterCalls, 0)
  const withToJson = { toJSON() { toJsonCalls += 1; return {} } }
  metadataError(() => snapshotOAuthJson(withToJson))
  assert.equal(toJsonCalls, 0)

  const source = { nested: [{ value: 1 }] }
  const copied = snapshotOAuthJson(source)
  source.nested[0].value = 2
  assert.equal(copied.nested[0].value, 1)
  const cycle: Record<string, unknown> = {}; cycle.self = cycle
  metadataError(() => snapshotOAuthJson(cycle))
  metadataError(() => snapshotOAuthJson({ value: 'x'.repeat(65 * 1024) }))
  metadataError(() => snapshotOAuthJson(Object.assign(Object.create({ inherited: true }), { issuer })))
  metadataError(() => snapshotOAuthJson(new Proxy({}, { ownKeys() { throw new Error('untrusted trap') } })))
})

test('resource metadata requires exact discovered resource identity and bounded HTTPS issuers', () => {
  const result = parseOAuthResourceMetadata({
    resource,
    authorization_servers: [issuer],
    scopes_supported: ['files:read', 'profile'],
  }, resource)
  assert.deepEqual(result, { resource, authorizationServers: [issuer], scopesSupported: ['files:read', 'profile'] })
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.authorizationServers) && Object.isFrozen(result.scopesSupported))
  for (const alias of ['https://MCP.example.test/agent', 'https://mcp.example.test:443/agent', 'https://mcp.example.test/x/../agent', 'https://mcp.example.test/%2e/agent']) {
    metadataError(() => parseOAuthResourceMetadata({ resource: alias, authorization_servers: [issuer] }, resource))
  }
  const exactTarget = 'https://mcp.example.test/'
  assert.equal(parseOAuthResourceMetadata({ resource: exactTarget, authorization_servers: [issuer] }, exactTarget).resource, exactTarget)
  metadataError(() => parseOAuthResourceMetadata({ resource: 'https://mcp.example.test', authorization_servers: [issuer] }, exactTarget))
  metadataError(() => parseOAuthResourceMetadata({ resource: 'https://mcp.example.test/other', authorization_servers: [issuer] }, resource))
  metadataError(() => parseOAuthResourceMetadata({ resource, authorization_servers: ['http://login.example.test'] }, resource))
  metadataError(() => parseOAuthResourceMetadata({ resource, authorization_servers: [`${issuer}?tenant=a`] }, resource))
  metadataError(() => parseOAuthResourceMetadata({ resource, authorization_servers: [issuer, issuer] }, resource))
  metadataError(() => parseOAuthResourceMetadata({ resource, authorization_servers: ['https://user:pass@login.example.test'] }, resource))
  metadataError(() => parseOAuthResourceMetadata({ resource, authorization_servers: ['https://login.example.test/#frag'] }, resource))
  const longIssuer = `https://login.example.test/${'x'.repeat(300)}`
  assert.equal(parseOAuthResourceMetadata({ resource, authorization_servers: [longIssuer] }, resource).authorizationServers[0], longIssuer)
  metadataError(() => parseOAuthResourceMetadata({ resource, authorization_servers: [] }, resource))
})

test('authorization metadata validates exact issuer and public PKCE authorization-code support', () => {
  const parsed = parseOAuthServerMetadata(serverMetadata({
    registration_endpoint: 'https://login.example.test/register',
    scopes_supported: ['files:read'],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
  }), issuer)
  assert.deepEqual(parsed, {
    issuer,
    authorizationEndpoint: 'https://login.example.test/authorize',
    tokenEndpoint: 'https://login.example.test/token',
    registrationEndpoint: 'https://login.example.test/register',
    scopesSupported: ['files:read'],
    supportsClientMetadata: true,
    issuerParameterSupported: true,
  })
  assert.ok(Object.isFrozen(parsed) && Object.isFrozen(parsed.scopesSupported))
  metadataError(() => parseOAuthServerMetadata(serverMetadata({ issuer: 'https://LOGIN.example.test/tenant-a' }), issuer))
  metadataError(() => parseOAuthServerMetadata(serverMetadata({ issuer: 'https://login.example.test/tenant-a/' }), issuer))
  metadataError(() => parseOAuthServerMetadata(serverMetadata({ authorization_endpoint: 'http://login.example.test/authorize' }), issuer))
  metadataError(() => parseOAuthServerMetadata(serverMetadata({ token_endpoint: 'https://user:pass@login.example.test/token' }), issuer))
  metadataError(() => parseOAuthServerMetadata(serverMetadata({ token_endpoint: 'https://login.example.test/token#' }), issuer))
  metadataError(() => parseOAuthServerMetadata(serverMetadata({ response_types_supported: ['token'] }), issuer), 'unsupported')
  metadataError(() => parseOAuthServerMetadata(serverMetadata({ grant_types_supported: ['client_credentials'] }), issuer), 'unsupported')
  metadataError(() => parseOAuthServerMetadata(serverMetadata({ token_endpoint_auth_methods_supported: ['client_secret_basic'] }), issuer), 'unsupported')
  metadataError(() => parseOAuthServerMetadata(serverMetadata({ code_challenge_methods_supported: ['plain'] }), issuer), 'unsupported')
  // RFC 8414 defaults omitted grant/auth metadata; the public-client default
  // is client_secret_basic, so omission does not imply support for `none`.
  const omittedDefaults = serverMetadata()
  delete omittedDefaults.grant_types_supported
  delete omittedDefaults.token_endpoint_auth_methods_supported
  metadataError(() => parseOAuthServerMetadata(omittedDefaults, issuer), 'unsupported')
  metadataError(() => parseOAuthServerMetadata(serverMetadata({ client_id_metadata_document_supported: 'true' }), issuer))
})

test('scope parsing enforces OAuth ASCII token grammar, uniqueness and total limits', () => {
  assert.deepEqual(oauthScopes(['files:read', 'profile']), ['files:read', 'profile'])
  assert.ok(Object.isFrozen(oauthScopes([])))
  for (const bad of [
    ['has space'], ['quote"'], ['back\\slash'], ['unicode-☃'], [''], ['same', 'same'],
    Array.from({ length: 65 }, (_, index) => `s${index}`), ['x'.repeat(4_097)],
  ]) metadataError(() => oauthScopes(bad))
  assert.equal(oauthScopes(['x'.repeat(4_096)])[0].length, 4_096)
})

test('URL helpers reject unsafe URL components but do not claim outbound address admission', () => {
  for (const bad of [
    'http://mcp.example.test', 'https://user:pass@mcp.example.test',
    'https://mcp.example.test/#fragment', 'https://mcp.example.test/#',
    'https://mcp.example.test/with space', 'https://mcp.example.test\n/path', 'https://mcp.example.test/a\\b',
  ]) {
    metadataError(() => resourceMetadataUrls(bad))
    metadataError(() => oauthHttpsUrl(bad))
  }
  metadataError(() => authorizationMetadataUrls('https://login.example.test/issuer?query=1'))
  metadataError(() => authorizationMetadataUrls('https://login.example.test/issuer?'))
  // These pure parsers perform syntax/identity checks only; network callers
  // still need the existing outbound DNS/address admission and socket pinning.
  assert.equal(oauthHttpsUrl('https://127.0.0.1/token'), 'https://127.0.0.1/token')
})
