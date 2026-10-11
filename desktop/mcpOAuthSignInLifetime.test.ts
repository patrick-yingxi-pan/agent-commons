import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMcpOAuthSignIn, McpOAuthSignInError } from './mcpOAuthSignIn.mjs'
import { openMcpOAuthCallback } from './mcpOAuthCallback.mjs'

const issuer = 'https://login.example.test/tenant'
const endpoint = 'https://mcp.example.test/agent'
const metadata = {
  issuer,
  authorization_endpoint: `${issuer}/authorize`,
  token_endpoint: `${issuer}/token`,
  response_types_supported: ['code'],
  grant_types_supported: ['authorization_code', 'refresh_token'],
  token_endpoint_auth_methods_supported: ['none'],
  code_challenge_methods_supported: ['S256'],
  registration_endpoint: `${issuer}/register`,
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(yes => { resolve = yes })
  return { promise, resolve }
}

const input = (connectionId: string) => ({
  issuer,
  metadata,
  binding: { tenantId: 'tenant-lifetime', connectionId, endpoint },
  ownerId: 'owner-lifetime',
  scopes: ['files:read'],
})

const isSignInError = (code: string) => (error: unknown) => error instanceof McpOAuthSignInError && error.code === code

function registrationResponse(request: { body: string }) {
  const body = JSON.parse(request.body)
  return {
    client_id: 'registered-client',
    application_type: body.application_type,
    token_endpoint_auth_method: body.token_endpoint_auth_method,
    redirect_uris: body.redirect_uris,
    response_types: body.response_types,
    grant_types: body.grant_types,
    scope: body.scope,
  }
}

for (const ending of ['cancelled', 'timeout'] as const) {
  test(`real callback keeps sign-in capacity after ${ending} through abort-ignoring registration preparation`, { timeout: 8_000 }, async () => {
    const registrationGate = deferred<void>()
    const firstStarted = deferred<void>()
    const firstReturned = deferred<void>()
    const preparationCancelled = deferred<void>()
    const secondStarted = deferred<void>()
    const browserStarted = deferred<void>()
    const browserGate = deferred<void>()
    let registrations = 0
    let exchanges = 0
    let provisions = 0
    let browsers = 0

    const manager = createMcpOAuthSignIn({
      http: {
        async register(request, options) {
          options.beforeDispatch()
          registrations += 1
          if (registrations === 1) {
            options.signal.addEventListener('abort', () => preparationCancelled.resolve(), { once: true })
            firstStarted.resolve()
            // This deliberately models a dependency that ignores its aborted
            // signal while its in-flight request remains unsettled.
            await registrationGate.promise
            firstReturned.resolve()
            return registrationResponse(request)
          }
          if (registrations === 2) secondStarted.resolve()
          return registrationResponse(request)
        },
        async exchange() { exchanges += 1; throw new Error('unexpected token exchange') },
      },
      vault: {
        async provisionOAuth() { provisions += 1; throw new Error('unexpected token provision') },
        async discard() {},
      },
      openBrowser: async () => { browsers += 1; browserStarted.resolve(); return browserGate.promise },
      // Make receiver expiry precede the outer timer deterministically. This is
      // still the real loopback listener and its real preparation cancellation.
      openCallback: (factory, options) => openMcpOAuthCallback(factory, {
        ...options, timeoutMs: ending === 'timeout' ? 1_000 : options.timeoutMs,
      }),
      now: () => 1_000,
      timeoutMs: 10_000,
      maxPending: 1,
    })

    const abort = new AbortController()
    let first: Promise<unknown> | undefined
    let reentry: Promise<unknown> | undefined
    try {
      first = manager.authorize(input('same-connection'), { isCurrent: () => true, signal: abort.signal })
      let terminalError: unknown
      void first.catch(error => { terminalError = error })
      await Promise.race([firstStarted.promise, first.then(() => assert.fail('sign-in completed before registration settled'))])
      if (ending === 'cancelled') abort.abort()
      await preparationCancelled.promise
      await new Promise<void>(resolve => setImmediate(resolve))
      assert.ok(isSignInError(ending)(terminalError), 'terminal outcome must publish before registration preparation drains')
      await assert.rejects(first, isSignInError(ending))

      // Neither the same key nor another key may consume the slot while the
      // callback factory is still awaiting the abort-ignoring registration.
      for (const connectionId of ['same-connection', 'other-connection']) {
        await Promise.race([
          assert.rejects(manager.authorize(input(connectionId), { isCurrent: () => true }), isSignInError('busy')),
          secondStarted.promise.then(() => assert.fail('sign-in released capacity before registration preparation settled')),
        ])
      }
      assert.equal(registrations, 1)

      registrationGate.resolve()
      await firstReturned.promise
      // Let the real callback factory observe its aborted signal and drain.
      await new Promise<void>(resolve => setImmediate(resolve))
      await new Promise<void>(resolve => setImmediate(resolve))

      reentry = manager.authorize(input('same-connection'), { isCurrent: () => true })
      await secondStarted.promise
      await browserStarted.promise
      assert.equal(registrations, 2, 'the connection is admitted again after the first preparation settles')
      assert.equal(browsers, 1, 'only the fresh, admitted transaction opens the browser')
      assert.equal(exchanges, 0)
      assert.equal(provisions, 0)

      manager.close()
      await assert.rejects(reentry, isSignInError('cancelled'))
    } finally {
      manager.close()
      registrationGate.resolve()
      browserGate.resolve()
      await Promise.allSettled([first, reentry].filter((value): value is Promise<unknown> => Boolean(value)))
    }
  })
}
