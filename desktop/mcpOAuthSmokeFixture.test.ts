import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import { test } from 'node:test'
import { createMcpDiscovery } from '../server/mcpDiscovery.ts'
import { createMcpHttpTransport } from '../server/mcpHttpTransport.ts'
import { createMcpFormToolCaller, createMcpToolCaller } from '../server/mcpToolCall.ts'
import {
  createMcpOAuthSmokeFixture,
  MCP_OAUTH_FIXTURE_ACCESS_CANARY,
  MCP_OAUTH_FIXTURE_ISSUER,
  MCP_OAUTH_FIXTURE_REFRESH_CANARY,
  MCP_OAUTH_FIXTURE_REFRESHED_ACCESS_CANARY,
  MCP_OAUTH_FIXTURE_REFRESHED_REFRESH_CANARY,
  MCP_OAUTH_FIXTURE_RESOURCE,
  MCP_OAUTH_FORM_QUERY,
  MCP_OAUTH_FORM_STATE,
  MCP_OAUTH_FORM_ANSWER,
  MCP_OAUTH_FORM_MESSAGE,
} from './mcpOAuthSmokeFixture.mjs'

const VERSION = '2026-07-28'
const redirectUri = 'http://127.0.0.1:43123/oauth/callback'
const verifier = 'fixture-verifier-that-is-long-enough-for-pkce-0123456789'
const challenge = createHash('sha256').update(verifier).digest('base64url')

async function issueAccessToken(fixture) {
  const registered = await fixture.dispatch({ method: 'POST', path: '/register', body: JSON.stringify({
    client_name: 'Agent Commons', application_type: 'native', redirect_uris: [redirectUri],
    token_endpoint_auth_method: 'none', grant_types: ['authorization_code'], response_types: ['code'], scope: 'records:read',
  }) })
  const clientId = JSON.parse(registered.body).client_id
  const auth = new URL(`${MCP_OAUTH_FIXTURE_ISSUER}/authorize`)
  for (const [key, value] of Object.entries({ response_type: 'code', client_id: clientId, redirect_uri: redirectUri,
    scope: 'records:read', resource: MCP_OAUTH_FIXTURE_RESOURCE, state: 'fixture-state-1',
    code_challenge: challenge, code_challenge_method: 'S256' })) auth.searchParams.set(key, value)
  const authorization = await fixture.dispatch({ method: 'GET', path: `${auth.pathname}${auth.search}` })
  const callback = new URL(authorization.headers.location)
  const token = await fixture.dispatch({ method: 'POST', path: '/token', body: new URLSearchParams({
    grant_type: 'authorization_code', code: callback.searchParams.get('code'), client_id: clientId,
    redirect_uri: redirectUri, code_verifier: verifier, resource: MCP_OAUTH_FIXTURE_RESOURCE, scope: 'records:read',
  }).toString() })
  assert.equal(token.status, 200)
  return JSON.parse(token.body).access_token
}

function fixtureTransport(fixture) {
  const transport = createMcpHttpTransport({
    resolve: async () => [{ address: '8.8.8.8', family: 4 }],
    https: (url, options, callback) => {
      const request = new EventEmitter()
      request.destroy = () => {}
      request.end = body => {
        const headers = Object.fromEntries(Object.entries(options.headers).map(([key, value]) => [key.toLowerCase(), value]))
        void fixture.dispatch({ method: options.method, path: `${url.pathname}${url.search}`, headers,
          body: body ? Buffer.from(body).toString('utf8') : '' }).then(result => {
          const response = Readable.from([Buffer.from(result.body)])
          response.statusCode = result.status
          response.headers = { ...result.headers, 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(result.body)) }
          response.complete = true
          callback(response)
        }).catch(error => request.emit('error', error))
      }
      return request
    },
  })
  return transport
}

const mcpRequest = (method, params = {}, id = 'fixture-rpc-1') => JSON.stringify({
  jsonrpc: '2.0', id, method,
  params: { ...params, _meta: {
    'io.modelcontextprotocol/protocolVersion': VERSION,
    'io.modelcontextprotocol/clientInfo': { name: 'agent-commons', version: '0.1.0' },
    'io.modelcontextprotocol/clientCapabilities': {},
  } },
})

test('local fixture completes challenge, metadata, registration, PKCE, catalog, call and refresh deterministically', async () => {
  const fixture = createMcpOAuthSmokeFixture()
  const probe = await fixture.dispatch({ method: 'POST', path: '/mcp', body: mcpRequest('server/discover'), headers: {
    'mcp-protocol-version': VERSION, 'mcp-method': 'server/discover',
  } })
  assert.equal(probe.status, 401)
  assert.match(probe.headers['www-authenticate'], /resource_metadata=/)
  assert.match(probe.headers['www-authenticate'], /scope="records:read"/)

  const prm = await fixture.dispatch({ method: 'GET', path: '/.well-known/oauth-protected-resource/mcp' })
  assert.equal(prm.status, 200)
  assert.deepEqual(JSON.parse(prm.body), {
    resource: MCP_OAUTH_FIXTURE_RESOURCE,
    authorization_servers: [MCP_OAUTH_FIXTURE_ISSUER],
    scopes_supported: ['records:read'],
  })
  const as = await fixture.dispatch({ method: 'GET', path: '/.well-known/oauth-authorization-server' })
  assert.equal(as.status, 200)
  assert.equal(JSON.parse(as.body).issuer, MCP_OAUTH_FIXTURE_ISSUER)
  assert.deepEqual(JSON.parse(as.body).code_challenge_methods_supported, ['S256'])

  const registrationBody = JSON.stringify({
    client_name: 'Agent Commons', application_type: 'native', redirect_uris: [redirectUri],
    token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'], scope: 'records:read',
  })
  const registration = await fixture.dispatch({ method: 'POST', path: '/register', body: registrationBody })
  assert.equal(registration.status, 201)
  const clientId = JSON.parse(registration.body).client_id
  assert.equal(JSON.parse(registration.body).token_endpoint_auth_method, 'none')

  const authorizationUrl = new URL(`${MCP_OAUTH_FIXTURE_ISSUER}/authorize`)
  for (const [key, value] of Object.entries({
    response_type: 'code', client_id: clientId, redirect_uri: redirectUri, scope: 'records:read',
    resource: MCP_OAUTH_FIXTURE_RESOURCE, state: 'fixture-state-1', code_challenge: challenge,
    code_challenge_method: 'S256',
  })) authorizationUrl.searchParams.set(key, value)
  const authorization = await fixture.dispatch({ method: 'GET', path: `${authorizationUrl.pathname}${authorizationUrl.search}` })
  assert.equal(authorization.status, 302)
  const callback = new URL(authorization.headers.location)
  assert.equal(callback.origin, new URL(redirectUri).origin)
  assert.equal(callback.pathname, '/oauth/callback')
  assert.equal(callback.searchParams.get('state'), 'fixture-state-1')
  assert.equal(callback.searchParams.get('iss'), MCP_OAUTH_FIXTURE_ISSUER)
  const code = callback.searchParams.get('code')

  const exchange = values => new URLSearchParams({
    grant_type: 'authorization_code', code, client_id: clientId, redirect_uri: redirectUri,
    code_verifier: values.verifier, resource: MCP_OAUTH_FIXTURE_RESOURCE, scope: 'records:read',
  }).toString()
  const badPkce = await fixture.dispatch({ method: 'POST', path: '/token', body: exchange({ verifier: 'wrong-verifier' }) })
  assert.equal(badPkce.status, 400, 'a wrong verifier cannot redeem the issued code')
  const token = await fixture.dispatch({ method: 'POST', path: '/token', body: exchange({ verifier }) })
  assert.equal(token.status, 200)
  const grant = JSON.parse(token.body)
  assert.equal(grant.access_token, MCP_OAUTH_FIXTURE_ACCESS_CANARY)
  assert.equal(grant.refresh_token, MCP_OAUTH_FIXTURE_REFRESH_CANARY)
  assert.equal(grant.expires_in, 60)

  const authHeaders = { authorization: `Bearer ${grant.access_token}`, 'mcp-protocol-version': VERSION }
  const discover = await fixture.dispatch({ method: 'POST', path: '/mcp', headers: { ...authHeaders, 'mcp-method': 'server/discover' }, body: mcpRequest('server/discover') })
  assert.equal(discover.status, 200)
  assert.ok(JSON.parse(discover.body).result.capabilities.tools)
  assert.equal(JSON.parse(discover.body).result.resultType, 'complete')
  const list = await fixture.dispatch({ method: 'POST', path: '/mcp', headers: { ...authHeaders, 'mcp-method': 'tools/list' }, body: mcpRequest('tools/list') })
  assert.equal(list.status, 200)
  assert.deepEqual(JSON.parse(list.body).result.tools[0].inputSchema.required, ['query'])
  const call = await fixture.dispatch({ method: 'POST', path: '/mcp', headers: { ...authHeaders, 'mcp-method': 'tools/call', 'mcp-name': 'encoded-name' },
    body: mcpRequest('tools/call', { name: 'records.search', arguments: { query: 'owner-visible-record' } }) })
  assert.equal(call.status, 200)
  assert.deepEqual(JSON.parse(call.body).result.structuredContent, { query: 'owner-visible-record', record: 'fixture-record-1' })
  assert.equal(JSON.parse(call.body).result.resultType, 'complete')

  fixture.expireAccess()
  const expired = await fixture.dispatch({ method: 'POST', path: '/mcp', headers: { ...authHeaders, 'mcp-method': 'tools/list' }, body: mcpRequest('tools/list') })
  assert.equal(expired.status, 401)
  const refreshBody = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: grant.refresh_token,
    client_id: clientId, resource: MCP_OAUTH_FIXTURE_RESOURCE, scope: 'records:read' }).toString()
  const refreshed = await fixture.dispatch({ method: 'POST', path: '/token', body: refreshBody })
  assert.equal(refreshed.status, 200)
  assert.equal(JSON.parse(refreshed.body).access_token, MCP_OAUTH_FIXTURE_REFRESHED_ACCESS_CANARY)
  assert.equal(JSON.parse(refreshed.body).refresh_token, MCP_OAUTH_FIXTURE_REFRESHED_REFRESH_CANARY)
  const refreshedCall = await fixture.dispatch({ method: 'POST', path: '/mcp', headers: {
    authorization: `Bearer ${MCP_OAUTH_FIXTURE_REFRESHED_ACCESS_CANARY}`, 'mcp-protocol-version': VERSION, 'mcp-method': 'tools/list',
  }, body: mcpRequest('tools/list') })
  assert.equal(refreshedCall.status, 200)
  assert.deepEqual(fixture.snapshot().counts, {
    registrations: 1, codes: 1, refreshes: 1, resourceMetadata: 1, serverMetadata: 1, probes: 1, mcpCalls: 1,
  })
  assert.ok(fixture.snapshot().requests.some(request => request.body.includes(verifier)))
})

test('real discovery and tool-result parsers accept the fixture through the production HTTP transport', async () => {
  const fixture = createMcpOAuthSmokeFixture()
  const post = fixtureTransport(fixture)
  const discover = createMcpDiscovery({ post })
  const call = createMcpToolCaller({ post })
  const accessToken = await issueAccessToken(fixture)
  const options = { scope: 'public', bearerToken: accessToken }
  const catalog = await discover(MCP_OAUTH_FIXTURE_RESOURCE, options)
  assert.equal(catalog.protocolVersion, VERSION)
  assert.deepEqual(catalog.tools.map(tool => tool.name), ['records.search'])
  assert.deepEqual(catalog.tools[0].inputSchema.required, ['query'])

  const result = await call(MCP_OAUTH_FIXTURE_RESOURCE, {
    protocolVersion: VERSION,
    tool: catalog.tools[0],
    arguments: { query: 'owner-visible-record' },
  }, options)
  assert.equal(result.resultType, 'complete')
  assert.deepEqual(result.structuredContent, { query: 'owner-visible-record', record: 'fixture-record-1' })
  assert.equal(fixture.snapshot().counts.probes, 0, 'authenticated MCP discovery does not need another unauthenticated probe')
  assert.deepEqual(fixture.snapshot().requests.filter(request => request.headers['mcp-method']).map(request => request.headers['mcp-method']),
    ['server/discover', 'tools/list', 'tools/call'])
})

test('fixture refuses extra registration authority, malformed callback intent, bad tool arguments and unknown paths', async () => {
  const fixture = createMcpOAuthSmokeFixture()
  const registration = await fixture.dispatch({ method: 'POST', path: '/register', body: JSON.stringify({
    client_name: 'Agent Commons', application_type: 'native', redirect_uris: [redirectUri],
    token_endpoint_auth_method: 'none', grant_types: ['authorization_code'], response_types: ['code'],
    scope: 'records:read', client_secret: 'not-allowed',
  }) })
  assert.equal(registration.status, 400)
  const unknown = await fixture.dispatch({ method: 'GET', path: '/unrecognized' })
  assert.equal(unknown.status, 404)
  const malformed = await fixture.dispatch({ method: 'POST', path: '/token', body: 'grant_type=authorization_code&grant_type=refresh_token' })
  assert.equal(malformed.status, 400)
  assert.equal(fixture.snapshot().counts.registrations, 0)
  assert.ok(!fixture.snapshot().requests.some(request => request.body.includes(MCP_OAUTH_FIXTURE_ACCESS_CANARY)))
})

test('fixture exposes a local HTTP origin and drains it on close when socket binding is permitted', async t => {
  const fixture = createMcpOAuthSmokeFixture()
  try { await fixture.listen() }
  catch (error) {
    await fixture.close()
    if (error?.code === 'EPERM' || error?.code === 'EACCES') return t.skip('sandbox does not permit loopback listeners')
    throw error
  }
  try {
    assert.match(fixture.origin, /^http:\/\/127\.0\.0\.1:\d+$/)
    const response = await fetch(`${fixture.origin}/.well-known/oauth-protected-resource/mcp`)
    assert.equal(response.status, 200)
    assert.equal((await response.json()).resource, MCP_OAUTH_FIXTURE_RESOURCE)
  } finally { await fixture.close() }
  assert.equal(fixture.origin, undefined)
})

test('opt-in private form fixture requires explicit capabilities and one exact continuation; default calls stay ordinary', async () => {
  const ordinary = createMcpOAuthSmokeFixture()
  const ordinaryPost = fixtureTransport(ordinary)
  const ordinaryOptions = { scope: 'public', bearerToken: await issueAccessToken(ordinary) }
  const ordinaryCatalog = await createMcpDiscovery({ post: ordinaryPost })(MCP_OAUTH_FIXTURE_RESOURCE, ordinaryOptions)
  const ordinaryResult = await createMcpToolCaller({ post: ordinaryPost })(MCP_OAUTH_FIXTURE_RESOURCE, {
    protocolVersion: VERSION, tool: ordinaryCatalog.tools[0], arguments: { query: MCP_OAUTH_FORM_QUERY },
  }, ordinaryOptions)
  assert.equal(ordinaryResult.resultType, 'complete', 'default comprehensive smoke never receives form requests')

  const fixture = createMcpOAuthSmokeFixture({ formReview: true })
  const post = fixtureTransport(fixture)
  const options = { scope: 'public', bearerToken: await issueAccessToken(fixture) }
  const catalog = await createMcpDiscovery({ post })(MCP_OAUTH_FIXTURE_RESOURCE, options)
  const invocation = { protocolVersion: VERSION, tool: catalog.tools[0], arguments: { query: MCP_OAUTH_FORM_QUERY } }
  await assert.rejects(createMcpToolCaller({ post })(MCP_OAUTH_FIXTURE_RESOURCE, invocation, options), /MCP tool call failed/)
  const call = createMcpFormToolCaller({ post })
  const pending = await call(MCP_OAUTH_FIXTURE_RESOURCE, invocation, options)
  assert.equal(pending.resultType, 'input_required')
  assert.equal(pending.requestState, MCP_OAUTH_FORM_STATE)
  assert.equal(pending.inputRequests.review.params.message, MCP_OAUTH_FORM_MESSAGE)
  const responses = { review: { action: 'accept', content: { note: MCP_OAUTH_FORM_ANSWER, approved: true } } }
  await assert.rejects(call(MCP_OAUTH_FIXTURE_RESOURCE, { ...invocation,
    continuation: { pending: { ...pending, requestState: pending.requestState.trim() }, responses },
  }, options), /MCP tool call failed/, 'opaque state cannot be normalized')
  const completed = await call(MCP_OAUTH_FIXTURE_RESOURCE, { ...invocation, continuation: { pending, responses } }, options)
  assert.equal(completed.resultType, 'complete')
  assert.deepEqual(completed.structuredContent, { query: MCP_OAUTH_FORM_QUERY, record: 'fixture-record-1' })
  assert.equal(JSON.stringify(completed).includes(MCP_OAUTH_FORM_ANSWER), false)
  await assert.rejects(call(MCP_OAUTH_FIXTURE_RESOURCE, { ...invocation, continuation: { pending, responses } }, options),
    /MCP tool call failed/, 'the fixture refuses a second explicit continuation')
  const bodies = fixture.snapshot().requests.filter(row => row.headers['mcp-method'] === 'tools/call').map(row => JSON.parse(row.body))
  assert.notEqual(bodies[1].id, bodies[3].id)
  assert.deepEqual(bodies[1].params.arguments, bodies[3].params.arguments)
  assert.equal(bodies[3].params.requestState, MCP_OAUTH_FORM_STATE)
  assert.deepEqual(bodies[3].params.inputResponses, responses)
})
