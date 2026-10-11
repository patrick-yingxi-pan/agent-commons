import { test } from 'node:test'
import assert from 'node:assert/strict'
import { once, EventEmitter } from 'node:events'
import { createServer, request as httpsRequest } from 'node:https'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createMcpOAuthHttp, McpOAuthHttpError } from './mcpOAuthHttp.mjs'
import { createMcpOAuthRefreshRequest } from './mcpOAuthTokens.mjs'
import { createMcpOAuthRefreshManager } from './mcpOAuthRefresh.mjs'
import { createMcpOAuthDiscovery } from './mcpOAuthDiscovery.mjs'
import { createMcpOAuthAuthorization } from './mcpOAuthAuthorization.mjs'
import { oauthResourceUrl } from './mcpOAuthMetadata.mjs'
import { openMcpCredentialVault } from './mcpCredentialVault.mjs'
import { MCP_MODERN_VERSION, mcpRequestMetadata } from '../server/mcpProtocolCore.mjs'

const PUBLIC = '93.184.215.14'
const options = () => ({ isCurrent: () => true })
const exchangeOptions = () => ({ ...options(), beforeDispatch() {} })
const grant = (tokenEndpoint = 'https://oauth.fixture.test/token') => ({
  issuer: 'https://oauth.fixture.test', tokenEndpoint, clientId: 'desktop fixture',
  resource: 'https://resource.fixture.test/mcp', scopes: ['records:read'], accessToken: 'old-access',
  refreshToken: 'private refresh fixture', expiresAt: 1,
})
const prepared = (endpoint?: string) => createMcpOAuthRefreshRequest(grant(endpoint))
const failure = (code: string, submitted?: boolean, status?: number) => error => {
  assert.ok(error instanceof McpOAuthHttpError)
  assert.equal(error.code, code)
  if (submitted !== undefined) assert.equal(error.mayHaveSubmitted, submitted)
  if (status !== undefined) assert.equal(error.status, status)
  assert.doesNotMatch(error.stack, /private refresh|private-query|remote-secret|oauth\.fixture/)
  return true
}
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes }); return { promise, resolve } }
const tick = () => new Promise(resolve => setImmediate(resolve))
async function until(predicate) {
  const deadline = performance.now() + 2_000
  while (!predicate()) {
    assert.ok(performance.now() < deadline, 'fixture observation completed within its deadline')
    await tick()
  }
}

/** Real TLS peer, isolated local certificate and explicit test-only routing.
 * The production options must still pin a public address and verify the exact
 * URL hostname. Only this injected adapter maps that address to the local peer. */
async function peer(t, handler, { trusted = true, hostname = 'oauth.fixture.test' } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'ac-oauth-http-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const keyPath = join(directory, 'key.pem'), certPath = join(directory, 'cert.pem')
  const generated = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyPath, '-out', certPath,
    '-days', '1', '-subj', '/CN=oauth.fixture.test', '-addext', 'subjectAltName=DNS:oauth.fixture.test'])
  assert.equal(generated.status, 0)
  const cert = readFileSync(certPath)
  const server = createServer({ key: readFileSync(keyPath), cert }, handler)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) })
  const endpoint = `https://${hostname}:${server.address().port}/token?private-query=fixture`
  const client = createMcpOAuthHttp({ resolve: async () => [{ address: PUBLIC, family: 4 }], request(url, config, callback) {
    assert.equal(url.hostname, hostname)
    assert.equal(config.agent, false)
    assert.equal(config.rejectUnauthorized, true)
    assert.equal(config.autoSelectFamily, false)
    assert.equal(config.maxHeaderSize, 16_384)
    assert.equal(config.headers.Authorization, undefined)
    assert.equal(config.headers.Cookie, undefined)
    return httpsRequest(url, { ...config, ...(trusted ? { ca: cert } : {}), lookup(host, settings, complete) {
      config.lookup(host, settings, (error, address, family) => {
        assert.equal(error, null); assert.equal(address, PUBLIC); assert.equal(family, 4)
        complete(null, '127.0.0.1', 4)
      })
    } }, callback)
  } })
  t.after(() => client.close())
  return { client, endpoint, directory }
}

test('native OAuth admits only bounded public HTTPS and explicit current authority before DNS', async () => {
  let resolutions = 0
  const client = createMcpOAuthHttp({ resolve: async () => { resolutions++; throw new Error() } })
  for (const endpoint of ['http://example.com', 'https://127.0.0.1', 'https://10.0.0.1', 'https://[::1]', 'https://localhost',
    'https://user:secret@example.com', 'https://example.com/#', 'https://example.com/\\path', `https://example.com/${'x'.repeat(2048)}`]) {
    await assert.rejects(client.getMetadata(endpoint, options()), failure('destination', false))
  }
  for (const extra of [{ scope: 'loopback' }, { headers: { Authorization: 'secret' } }, { rejectUnauthorized: false }, { timeoutMs: 0 }, { timeoutMs: 60_001 }]) {
    await assert.rejects(client.getMetadata('https://example.com', { ...options(), ...extra }), failure('request', false))
  }
  await assert.rejects(client.getMetadata('https://example.com'), failure('request', false))
  await assert.rejects(client.getMetadata('https://example.com', { isCurrent: () => false }), failure('stale', false))
  await assert.rejects(client.getMetadata('https://example.com', { isCurrent: async () => true }), failure('request', false))
  assert.equal(resolutions, 0)
  client.close()
})

test('all DNS answers must be public and correctly typed; unsafe mixed results never construct a request', async () => {
  for (const rows of [[], [{ address: PUBLIC, family: 4 }, { address: '10.0.0.1', family: 4 }],
    [{ address: '::ffff:127.0.0.1', family: 6 }], [{ address: PUBLIC, family: 6 }], Array(65).fill({ address: PUBLIC, family: 4 })]) {
    let sockets = 0
    const client = createMcpOAuthHttp({ resolve: async () => rows, request() { sockets++; throw new Error() } })
    await assert.rejects(client.getMetadata('https://example.com', options()), failure('destination', false))
    assert.equal(sockets, 0); client.close()
  }
})

test('a single pinned POST retains TLS hostname and does not replay after submission failure', async () => {
  let requests = 0, fences = 0, lookups = 0
  const client = createMcpOAuthHttp({ resolve: async () => { lookups++; return [{ address: PUBLIC, family: 4 }] }, request(url, config) {
    requests++
    assert.equal(fences, 1)
    assert.equal(url.hostname, 'oauth.fixture.test')
    assert.equal(config.rejectUnauthorized, true); assert.equal(config.agent, false)
    config.lookup('oauth.fixture.test', {}, (error, address, family) => {
      assert.equal(error, null); assert.equal(address, PUBLIC); assert.equal(family, 4)
    })
    const outgoing = new EventEmitter()
    outgoing.destroy = () => { queueMicrotask(() => outgoing.emit('close')) }
    outgoing.end = body => { assert.equal(body, prepared().body); queueMicrotask(() => outgoing.emit('error', new Error('remote-secret'))) }
    return outgoing
  } })
  await assert.rejects(client.exchange(prepared(), { ...options(), beforeDispatch() { fences++ } }), failure('network', true))
  assert.equal(requests, 1); assert.equal(lookups, 1); client.close()
})

test('DNS deadline and cancellation prevent late I/O, while unsettled resolution retains capacity', async () => {
  const gate = deferred()
  let sockets = 0
  const client = createMcpOAuthHttp({ maxPending: 1, resolve: () => gate.promise, request() { sockets++; throw new Error() } })
  await assert.rejects(client.getMetadata('https://example.com', { ...options(), timeoutMs: 200 }), failure('timeout', false))
  await assert.rejects(client.getMetadata('https://example.com', options()), failure('busy', false))
  gate.resolve([{ address: PUBLIC, family: 4 }])
  await tick()
  assert.equal(sockets, 0)
  const abort = new AbortController(); abort.abort()
  await assert.rejects(client.getMetadata('https://example.com', { ...options(), signal: abort.signal }), failure('cancelled', false))
  client.close()
  await assert.rejects(client.getMetadata('https://example.com', options()), failure('cancelled', false))
})

test('current-scope and synchronous token-dispatch fences are rechecked after DNS', async () => {
  for (const mode of ['stale', 'cancelled', 'dispatch', 'async-dispatch']) {
    const gate = deferred(); let current = true, sockets = 0
    const abort = new AbortController()
    const client = createMcpOAuthHttp({ resolve: () => gate.promise, request() { sockets++; throw new Error() } })
    const pending = client.exchange(prepared(), { isCurrent: () => current, signal: abort.signal,
      beforeDispatch: mode === 'dispatch' ? () => { throw new Error('remote-secret') } : mode === 'async-dispatch' ? async () => { throw new Error('remote-secret') } : () => {},
    })
    await tick()
    if (mode === 'stale') current = false
    if (mode === 'cancelled') abort.abort()
    gate.resolve([{ address: PUBLIC, family: 4 }])
    await assert.rejects(pending, failure(mode === 'cancelled' ? 'cancelled' : 'stale', false))
    assert.equal(sockets, 0); client.close()
  }
})

test('prepared request and options cannot be changed while DNS is pending', async () => {
  const gate = deferred()
  const input = { ...prepared() }
  const original = input.body
  const config = exchangeOptions()
  let sent, dispatches = 0
  config.beforeDispatch = () => { dispatches++ }
  const client = createMcpOAuthHttp({ resolve: () => gate.promise, request(url) {
    assert.equal(url.hostname, 'oauth.fixture.test')
    const outgoing = new EventEmitter()
    outgoing.destroy = () => { queueMicrotask(() => outgoing.emit('close')) }
    outgoing.end = body => { sent = body; queueMicrotask(() => outgoing.emit('error', new Error())) }
    return outgoing
  } })
  const pending = client.exchange(input, config)
  input.body = 'changed'; input.endpoint = 'https://other.example'; config.isCurrent = () => false; config.beforeDispatch = () => { throw new Error() }
  gate.resolve([{ address: PUBLIC, family: 4 }])
  await assert.rejects(pending, failure('network', true))
  assert.equal(sent, original); assert.equal(dispatches, 1); client.close()
})

test('destroyed requests keep capacity until their actual close event', async () => {
  let outgoing, destroys = 0
  const client = createMcpOAuthHttp({ maxPending: 1, resolve: async () => [{ address: PUBLIC, family: 4 }], request() {
    outgoing = new EventEmitter()
    outgoing.destroy = () => { destroys++ }
    outgoing.end = () => {}
    return outgoing
  } })
  const abort = new AbortController()
  const pending = client.getMetadata('https://example.com', { ...options(), signal: abort.signal })
  await until(() => !!outgoing)
  abort.abort()
  await assert.rejects(pending, failure('cancelled', false))
  assert.equal(destroys, 1)
  await assert.rejects(client.getMetadata('https://example.com', options()), failure('busy', false))
  outgoing.emit('close')
  outgoing = undefined
  const recovering = client.getMetadata('https://example.com', options())
  await until(() => !!outgoing)
  client.close()
  await assert.rejects(recovering, failure('cancelled', false))
  outgoing.emit('close'); client.close()
})

test('token forms are detached, bounded and audience/client/scope-bound before DNS', async () => {
  let resolutions = 0
  const client = createMcpOAuthHttp({ resolve: async () => { resolutions++; throw new Error() } })
  const raw = prepared()
  for (const invalid of [{ ...raw, body: `${raw.body}&client_secret=secret` }, { ...raw, body: `${raw.body}&client_id=other` },
    { ...raw, resource: 'https://foreign.example' }, { ...raw, clientId: 'other' }, { ...raw, scopes: ['admin'] },
    { ...raw, extra: true }, { ...raw, body: 'x'.repeat(65_537) }, { ...raw, body: 'grant_type=password' }]) {
    await assert.rejects(client.exchange(invalid, exchangeOptions()), failure('request', false))
  }
  let invoked = 0
  await assert.rejects(client.exchange({ ...raw, get body() { invoked++; return raw.body } }, exchangeOptions()), failure('request', false))
  assert.equal(invoked, 0); assert.equal(resolutions, 0); client.close()
})

test('real TLS metadata and form exchange use exact bytes with no ambient credentials', async t => {
  const received = []
  const { client, endpoint } = await peer(t, (req, res) => {
    const chunks = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => {
      received.push({ method: req.method, body: Buffer.concat(chunks).toString(), headers: req.headers })
      res.writeHead(200, { 'Content-Type': 'application/json; charset=UTF-8', 'Set-Cookie': 'ignored=secret' })
      res.end(JSON.stringify({ access_token: 'fresh-access', token_type: 'Bearer', text: 'café 世界' }))
    })
  })
  const metadata = await client.getMetadata(endpoint, options())
  assert.equal(metadata.document.text, 'café 世界')
  assert.ok(metadata.byteLength > 0)
  const result = await client.exchange(prepared(endpoint), exchangeOptions())
  assert.equal(result.access_token, 'fresh-access')
  assert.equal(received[0].method, 'GET'); assert.equal(received[0].body, '')
  assert.equal(received[1].method, 'POST'); assert.equal(received[1].body, prepared(endpoint).body)
  assert.equal(received[1].headers['content-type'], 'application/x-www-form-urlencoded')
  for (const row of received) {
    assert.equal(row.headers.cookie, undefined); assert.equal(row.headers.authorization, undefined)
    assert.equal(row.headers['accept-encoding'], 'identity')
  }
})

test('untrusted certificates and hostname mismatch fail before the TLS peer receives any HTTP credentials', async t => {
  for (const settings of [{ trusted: false }, { hostname: 'wrong.fixture.test' }]) {
    let requests = 0
    const { client, endpoint } = await peer(t, (_req, res) => { requests++; res.end('unexpected') }, settings)
    await assert.rejects(client.exchange(prepared(endpoint), exchangeOptions()), failure('network', true))
    assert.equal(requests, 0)
  }
})

test('real response admission refuses redirects, error bodies, encoding, malformed JSON/UTF-8 and oversized streams', async t => {
  let mode = '', requests = 0
  const { client, endpoint } = await peer(t, (_req, res) => {
    requests++
    if (mode === 'redirect') { res.writeHead(302, { Location: 'https://127.0.0.1/remote-secret' }); res.end(); return }
    if (mode === 'http') { res.writeHead(401); res.end('remote-secret'); return }
    const headers = { 'Content-Type': mode === 'type' ? 'text/html' : 'application/json' }
    if (mode === 'encoding') headers['Content-Encoding'] = 'gzip'
    if (mode === 'length') headers['Content-Length'] = '65537'
    res.writeHead(200, headers)
    if (mode === 'utf8') res.end(Buffer.from([0xff]))
    else if (mode === 'json') res.end('{remote-secret')
    else if (mode === 'array') res.end('[]')
    else if (mode === 'depth') res.end('{"value":'.repeat(18) + '0' + '}'.repeat(18))
    else if (mode === 'stream') res.end(' '.repeat(65_537))
    else res.end('{}')
  })
  for (const value of ['redirect', 'http', 'type', 'encoding', 'length', 'utf8', 'json', 'array', 'depth', 'stream']) {
    mode = value
    const before = requests
    await assert.rejects(client.getMetadata(endpoint, options()), failure(['redirect', 'http'].includes(value) ? value : 'response', false))
    assert.equal(requests, before + 1, 'no redirects or retries')
  }
})

test('oversized response headers and incomplete bodies are refused without reflecting peer details', async t => {
  let large = true
  const { client, endpoint } = await peer(t, (_req, res) => {
    if (large) { res.writeHead(200, { 'X-Untrusted': 'x'.repeat(17_000), 'Content-Type': 'application/json' }); res.end('{}') }
    else { res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': '200' }); res.write('{"partial":'); setImmediate(() => res.destroy()) }
  })
  await assert.rejects(client.getMetadata(endpoint, options()), failure('network', false))
  large = false
  await assert.rejects(client.getMetadata(endpoint, options()), failure('network', false))
})

test('active streaming cancellation, deadline and shutdown close the real socket', async t => {
  const began = [], ended = []
  const { client, endpoint } = await peer(t, (_req, res) => {
    const index = began.length
    began.push(true)
    res.on('close', () => { ended[index] = true })
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.write('{')
  })
  await assert.rejects(client.getMetadata(endpoint, { ...options(), timeoutMs: 1_000 }), failure('timeout', false))
  const abort = new AbortController()
  const cancelled = client.getMetadata(endpoint, { ...options(), signal: abort.signal })
  await until(() => began.length === 2)
  abort.abort(); await assert.rejects(cancelled, failure('cancelled', false))
  const shutdown = client.getMetadata(endpoint, options())
  await until(() => began.length === 3)
  client.close(); await assert.rejects(shutdown, failure('cancelled', false))
  await until(() => ended.filter(Boolean).length === 3)
  assert.equal(ended.filter(Boolean).length, 3)
})

test('authority lost while a real response body is pending prevents token publication', async t => {
  const began = deferred(), release = deferred()
  let current = true
  const { client, endpoint } = await peer(t, (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.write('{')
    began.resolve()
    void release.promise.then(() => res.end('"access_token":"fresh-access","token_type":"Bearer"}'))
  })
  const pending = client.exchange(prepared(endpoint), { isCurrent: () => current, beforeDispatch() {} })
  await began.promise
  current = false; release.resolve()
  await assert.rejects(pending, failure('stale', true))
})

test('the real read-only MCP probe shares protocol identity and only returns parsed challenge hints', async t => {
  let received
  const { client, endpoint } = await peer(t, (req, res) => {
    const chunks = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => {
      received = { body: JSON.parse(Buffer.concat(chunks).toString()), headers: req.headers }
      res.writeHead(401, { 'WWW-Authenticate': ['Basic realm="other, service"', 'Bearer resource_metadata="https://resource.fixture.test/metadata", scope="records:read"'] })
      res.write('remote-secret body that must not become metadata')
    })
  })
  const reply = await client.probe(endpoint, options())
  assert.deepEqual(reply, { status: 401, challenge: { resourceMetadataUrl: 'https://resource.fixture.test/metadata', scopes: ['records:read'] } })
  assert.equal(received.body.method, 'server/discover')
  assert.deepEqual(received.body.params, mcpRequestMetadata(MCP_MODERN_VERSION))
  assert.equal(received.headers['mcp-method'], 'server/discover')
  assert.equal(received.headers['mcp-protocol-version'], MCP_MODERN_VERSION)
})

test('real TLS refresh composes with durable reservation and never reuses an uncertain refresh token', async t => {
  let requests = 0, uncertain = false, observedGrant
  const { client, endpoint, directory } = await peer(t, (req, res) => {
    const chunks = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => {
      requests++
      observedGrant = new URLSearchParams(Buffer.concat(chunks).toString())
      if (uncertain) { res.destroy(); return }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ access_token: 'fresh-access', refresh_token: 'fresh-refresh', token_type: 'Bearer', expires_in: 10 }))
    })
  })
  const vault = await openMcpCredentialVault({ filePath: join(directory, 'vault.json'),
    encrypt: text => Buffer.from(text).map(byte => byte ^ 0xa5), decrypt: bytes => Buffer.from(bytes).map(byte => byte ^ 0xa5).toString() })
  const binding = { tenantId: 'tenant', connectionId: 'connection', endpoint: grant().resource }
  const reference = await vault.provisionOAuth(binding, 'owner', grant(endpoint))
  let now = 1
  const manager = createMcpOAuthRefreshManager({ vault, now: () => now, exchange: (request, exchangeOptions) => client.exchange(request, { ...exchangeOptions, ...options() }) })
  t.after(() => manager.close())
  assert.equal(await manager.resolve(reference, binding, 'owner', options()), 'fresh-access')
  assert.equal(observedGrant.get('refresh_token'), grant().refreshToken)
  assert.equal((await vault.readOAuth(reference, binding, 'owner')).grant.refreshToken, 'fresh-refresh')
  now = 10_001; uncertain = true
  await assert.rejects(manager.resolve(reference, binding, 'owner', options()))
  await assert.rejects(manager.resolve(reference, binding, 'owner', options()))
  assert.equal(requests, 2)
  assert.equal((await vault.readOAuth(reference, binding, 'owner')).state, 'reauthorization-required')
})

test('real TLS discovery composes with PKCE authorization and one exact code exchange', async t => {
  let endpoint, origin, exchanges = 0, receivedForm
  const paths = []
  const fixture = await peer(t, (req, res) => {
    paths.push([req.method, req.url])
    const chunks = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => {
      if (req.method === 'POST' && req.url.startsWith('/token')) {
        res.writeHead(401, { 'WWW-Authenticate': `Bearer resource_metadata="${origin}/metadata", scope="records:read"` })
        res.end(); return
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      if (req.url === '/metadata') res.end(JSON.stringify({ resource: oauthResourceUrl(endpoint), authorization_servers: [`${origin}/issuer`] }))
      else if (req.url === '/.well-known/oauth-authorization-server/issuer') res.end(JSON.stringify({
        issuer: `${origin}/issuer`, authorization_endpoint: `${origin}/authorize`, token_endpoint: `${origin}/exchange`,
        response_types_supported: ['code'], token_endpoint_auth_methods_supported: ['none'], code_challenge_methods_supported: ['S256'],
      }))
      else if (req.url === '/exchange') {
        exchanges++; receivedForm = new URLSearchParams(Buffer.concat(chunks).toString())
        res.end(JSON.stringify({ access_token: 'new-access', token_type: 'Bearer' }))
      } else res.end('{}')
    })
  })
  endpoint = fixture.endpoint; origin = new URL(endpoint).origin
  const discovery = createMcpOAuthDiscovery({ http: fixture.client })
  const resource = await discovery.discoverResource(endpoint, options())
  const server = await discovery.discoverServer(resource, resource.authorizationServers[0], options())
  const attempt = createMcpOAuthAuthorization({ issuer: server.issuer, metadata: server.metadata, clientId: 'desktop fixture',
    resource: resource.resource, scopes: resource.challengeScopes, redirectUri: 'http://127.0.0.1:49152/oauth/callback' })
  const authUrl = new URL(attempt.authorizationUrl)
  assert.equal(authUrl.searchParams.get('code_challenge_method'), 'S256')
  const callback = `${attempt.redirectUri}?${new URLSearchParams({ state: authUrl.searchParams.get('state'), code: 'fixture code' })}`
  const form = attempt.receiveCallback(callback)
  assert.equal((await fixture.client.exchange(form, exchangeOptions())).access_token, 'new-access')
  assert.equal(receivedForm.get('code'), 'fixture code')
  assert.equal(receivedForm.get('resource'), resource.resource)
  assert.equal(receivedForm.get('code_verifier').length, 43)
  assert.throws(() => attempt.receiveCallback(callback))
  assert.equal(exchanges, 1)
  assert.deepEqual(paths.map(row => row[0]), ['POST', 'GET', 'GET', 'POST'])
  assert.ok(Object.isFrozen(server.metadata) && Object.isFrozen(server.metadata.response_types_supported))
})
