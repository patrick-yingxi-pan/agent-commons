import { test } from 'node:test'
import assert from 'node:assert/strict'
import { McpOAuthSignInError, createMcpOAuthSignIn } from './mcpOAuthSignIn.mjs'
import { McpOAuthAuthorizationError } from './mcpOAuthAuthorization.mjs'

const issuer = 'https://login.example.test/tenant'
const registrationEndpoint = `${issuer}/register`
const tokenEndpoint = `${issuer}/token`
const endpoint = 'https://mcp.example.test/agent'
const binding = (connectionId = 'connection-native-signin') => ({ tenantId: 'tenant-native-signin', connectionId, endpoint })
const metadata = (extra: Record<string, unknown> = {}) => ({
  issuer,
  authorization_endpoint: `${issuer}/authorize`,
  token_endpoint: tokenEndpoint,
  response_types_supported: ['code'],
  grant_types_supported: ['authorization_code', 'refresh_token'],
  token_endpoint_auth_methods_supported: ['none'],
  code_challenge_methods_supported: ['S256'],
  registration_endpoint: registrationEndpoint,
  ...extra,
})
const input = (connectionId = 'connection-native-signin') => ({
  issuer, metadata: metadata(), binding: binding(connectionId), ownerId: 'owner-native-signin', scopes: ['files:read'],
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

const signInError = (code: string) => (error: unknown) => error instanceof McpOAuthSignInError && error.code === code

function makeHarness(overrides: Record<string, any> = {}) {
  const events: string[] = []
  const calls: Record<string, any[]> = { registrations: [], exchanges: [], provisions: [], discards: [], browsers: [], callbacks: [] }
  const authCode = 'private-auth-code-canary'
  const verifier = 'private-code-verifier-canary'
  const reference = 'mcp-oauth-device-reference'
  const http = {
    async register(request, options) {
      events.push('register:start')
      calls.registrations.push({ request, options })
      await options.beforeDispatch()
      events.push('register:dispatched')
      if (overrides.register) return overrides.register(request, options)
      const body = JSON.parse(request.body)
      return {
        client_id: 'registered-client-id',
        application_type: body.application_type,
        token_endpoint_auth_method: body.token_endpoint_auth_method,
        redirect_uris: body.redirect_uris,
        response_types: body.response_types,
        grant_types: body.grant_types,
        scope: body.scope,
      }
    },
    async exchange(request, options) {
      events.push('exchange:start')
      calls.exchanges.push({ request, options })
      await options.beforeDispatch()
      events.push('exchange:dispatched')
      if (overrides.exchange) return overrides.exchange(request, options)
      return { access_token: 'private-access-token-canary', token_type: 'Bearer', scope: 'files:read' }
    },
  }
  const vault = {
    async provisionOAuth(...args) {
      events.push('vault:provision')
      calls.provisions.push(args)
      if (overrides.provision) return overrides.provision(...args)
      return reference
    },
    async discard(...args) {
      events.push('vault:discard')
      calls.discards.push(args)
      if (overrides.discard) return overrides.discard(...args)
    },
  }
  const openCallback = async (factory, options) => {
    events.push('callback:open')
    calls.callbacks.push({ factory, options })
    const redirectUri = 'http://127.0.0.1:49152/oauth/callback'
    const prepared = await factory({ redirectUri, signal: options.signal })
    events.push('callback:prepared')
    if (overrides.openCallback) return overrides.openCallback(factory, options, prepared, redirectUri)
    const authorizationUrl = `${issuer}/authorize?client_id=${encodeURIComponent(prepared.clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}`
    return {
      authorizationUrl, redirectUri,
      result: Promise.resolve({
        endpoint: tokenEndpoint,
        body: new URLSearchParams({
          grant_type: 'authorization_code', code: authCode, client_id: prepared.clientId,
          redirect_uri: redirectUri, code_verifier: verifier, resource: endpoint,
        }).toString(),
        issuer, resource: endpoint, clientId: prepared.clientId, scopes: ['files:read'],
      }),
      cancel() { events.push('callback:cancel') },
    }
  }
  const openBrowser = async url => {
    events.push('browser:open')
    calls.browsers.push(url)
    return overrides.openBrowser ? overrides.openBrowser(url) : undefined
  }
  const manager = createMcpOAuthSignIn({ http, vault, openBrowser, openCallback, now: () => 1_000, ...overrides.manager })
  return { manager, http, vault, events, calls, authCode, verifier, reference }
}

test('one sign-in registers the actual callback then opens the browser, exchanges once and provisions only an opaque reference', async () => {
  const h = makeHarness()
  try {
    const result = await h.manager.authorize(input(), { isCurrent: () => true })
    assert.deepEqual(result, { reference: h.reference, issuer, scopes: ['files:read'], expiresAt: null })
    assert.ok(Object.isFrozen(result) && Object.isFrozen(result.scopes))
    assert.equal(JSON.stringify(result).includes(h.authCode), false)
    assert.equal(JSON.stringify(result).includes(h.verifier), false)
    assert.equal(JSON.stringify(result).includes('private-access-token-canary'), false)
    assert.deepEqual(h.events.slice(0, 7), [
      'callback:open', 'register:start', 'register:dispatched', 'callback:prepared',
      'browser:open', 'exchange:start', 'exchange:dispatched',
    ])
    assert.equal(h.calls.registrations.length, 1)
    assert.equal(h.calls.exchanges.length, 1)
    assert.equal(h.calls.provisions.length, 1)
    const registration = h.calls.registrations[0].request
    assert.equal(registration.redirectUri, 'http://127.0.0.1:49152/oauth/callback')
    assert.deepEqual(JSON.parse(registration.body).redirect_uris, [registration.redirectUri])
    const exchange = h.calls.exchanges[0].request
    assert.equal(exchange.endpoint, tokenEndpoint)
    assert.equal(new URLSearchParams(exchange.body).get('code'), h.authCode)
    assert.equal(new URLSearchParams(exchange.body).get('code_verifier'), h.verifier)
    assert.equal(exchange.clientId, 'registered-client-id')
    const [savedBinding, ownerId, grant] = h.calls.provisions[0]
    assert.deepEqual(savedBinding, binding())
    assert.equal(ownerId, 'owner-native-signin')
    assert.equal(grant.accessToken, 'private-access-token-canary')
    assert.equal(grant.expiresAt, null, 'unknown token lifetime remains unknown')
    assert.equal(grant.clientId, 'registered-client-id')
    assert.equal(h.calls.discards.length, 0)
  } finally { h.manager.close() }
})

test('a response denial or external-browser failure never exchanges or provisions', async () => {
  const denied = makeHarness({ openCallback: async (_factory, _options, _prepared, redirectUri) => ({
    authorizationUrl: `${issuer}/authorize`, redirectUri,
    result: Promise.reject(new McpOAuthAuthorizationError('denied')),
    cancel() {},
  }) })
  try {
    await assert.rejects(denied.manager.authorize(input(), { isCurrent: () => true }), signInError('denied'))
    assert.equal(denied.calls.exchanges.length, 0)
    assert.equal(denied.calls.provisions.length, 0)
  } finally { denied.manager.close() }

  const browserFailed = makeHarness({ openBrowser: async () => { throw new Error('private browser failure') } })
  try {
    await assert.rejects(browserFailed.manager.authorize(input(), { isCurrent: () => true }), signInError('unavailable'))
    assert.equal(browserFailed.calls.exchanges.length, 0)
    assert.equal(browserFailed.calls.provisions.length, 0)
  } finally { browserFailed.manager.close() }
})

test('registration-required is refused before opening a callback listener or making network requests', async () => {
  const h = makeHarness()
  const noRegistration = metadata()
  delete noRegistration.registration_endpoint
  try {
    await assert.rejects(h.manager.authorize({ ...input(), metadata: noRegistration }, { isCurrent: () => true }), signInError('client-required'))
    assert.equal(h.calls.callbacks.length, 0)
    assert.equal(h.calls.registrations.length, 0)
    assert.equal(h.calls.browsers.length, 0)
  } finally { h.manager.close() }
})

test('one pending operation per connection is enforced while a dependency ignores abort, retaining capacity until settlement', async () => {
  const gate = deferred<any>()
  const started = deferred<any>()
  const h = makeHarness({ register: async (_request, options) => { started.resolve(options); return gate.promise } })
  const abort = new AbortController()
  const first = h.manager.authorize(input(), { isCurrent: () => true, signal: abort.signal })
  const registerOptions = await started.promise
  abort.abort()
  await assert.rejects(first, signInError('cancelled'))
  assert.equal(registerOptions.signal.aborted, true)
  await assert.rejects(h.manager.authorize(input(), { isCurrent: () => true }), signInError('busy'))
  gate.resolve({ client_id: 'registered-client-id', application_type: 'native', token_endpoint_auth_method: 'none',
    redirect_uris: ['http://127.0.0.1:49152/oauth/callback'], response_types: ['code'], grant_types: ['authorization_code', 'refresh_token'], scope: 'files:read' })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.calls.browsers.length, 0)
  h.manager.close()
})

test('current-scope loss while browser is open prevents token exchange', async () => {
  const browserWait = deferred<void>()
  const browserStarted = deferred<void>()
  const h = makeHarness({ openBrowser: async () => { browserStarted.resolve(); return browserWait.promise } })
  let current = true
  try {
    const pending = h.manager.authorize(input(), { isCurrent: () => current })
    await browserStarted.promise
    current = false
    browserWait.resolve()
    await assert.rejects(pending, signInError('stale'))
    assert.equal(h.calls.exchanges.length, 0)
    assert.equal(h.calls.provisions.length, 0)
  } finally { h.manager.close() }
})

test('timeout and shutdown abort waiting work without releasing the connection slot before settlement', async () => {
  const gate = deferred<any>()
  const started = deferred<any>()
  const h = makeHarness({
    register: async (_request, options) => { started.resolve(options); return gate.promise },
    manager: { timeoutMs: 80 },
  })
  const pending = h.manager.authorize(input(), { isCurrent: () => true })
  const options = await started.promise
  await assert.rejects(pending, signInError('timeout'))
  assert.equal(options.signal.aborted, true)
  await assert.rejects(h.manager.authorize(input(), { isCurrent: () => true }), signInError('busy'))
  gate.resolve({ client_id: 'registered-client-id', application_type: 'native', token_endpoint_auth_method: 'none',
    redirect_uris: ['http://127.0.0.1:49152/oauth/callback'], response_types: ['code'], grant_types: ['authorization_code', 'refresh_token'], scope: 'files:read' })
  await new Promise(resolve => setImmediate(resolve))
  h.manager.close()

  const shutdownGate = deferred<any>()
  const shutdownStarted = deferred<any>()
  const shuttingDown = makeHarness({ register: async (_request, requestOptions) => { shutdownStarted.resolve(requestOptions); return shutdownGate.promise } })
  const duringClose = shuttingDown.manager.authorize(input(), { isCurrent: () => true })
  const shutdownOptions = await shutdownStarted.promise
  shuttingDown.manager.close()
  await assert.rejects(duringClose, signInError('cancelled'))
  assert.equal(shutdownOptions.signal.aborted, true)
  shutdownGate.resolve({ client_id: 'registered-client-id', application_type: 'native', token_endpoint_auth_method: 'none',
    redirect_uris: ['http://127.0.0.1:49152/oauth/callback'], response_types: ['code'], grant_types: ['authorization_code', 'refresh_token'], scope: 'files:read' })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(shuttingDown.calls.browsers.length, 0)
})

test('a stale account after provisional vault write discards the exact uncommitted reference', async () => {
  const provisionGate = deferred<string>()
  const provisionStarted = deferred<void>()
  const h = makeHarness({ provision: async (_binding, _owner, _grant, fence) => {
    provisionStarted.resolve()
    await provisionGate.promise
    return 'provisional-reference-after-stale'
  } })
  let current = true
  try {
    const pending = h.manager.authorize(input(), { isCurrent: () => current })
    await provisionStarted.promise
    current = false
    provisionGate.resolve('provisional-reference-after-stale')
    await assert.rejects(pending, signInError('stale'))
    assert.equal(h.calls.discards.length, 1)
    assert.equal(h.calls.discards[0][0], 'provisional-reference-after-stale')
    assert.deepEqual(h.calls.discards[0][1], binding())
  } finally { h.manager.close() }
})

test('invalid caller fences are stale and never leak thrown details', async () => {
  const h = makeHarness()
  try {
    await assert.rejects(h.manager.authorize(input(), { isCurrent: () => false }), signInError('stale'))
    await assert.rejects(h.manager.authorize(input(), { isCurrent: async () => true }), signInError('stale'))
    await assert.rejects(h.manager.authorize(input(), { isCurrent: () => { throw new Error('private account canary') } }), error => {
      assert.ok(error instanceof McpOAuthSignInError)
      assert.equal(error.message.includes('private account canary'), false)
      return true
    })
    assert.equal(h.calls.callbacks.length, 0)
  } finally { h.manager.close() }
})
