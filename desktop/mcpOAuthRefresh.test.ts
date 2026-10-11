import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openMcpCredentialVault, MCP_CREDENTIAL_FILE } from './mcpCredentialVault.mjs'
import { createMcpOAuthRefreshManager, McpOAuthRefreshError } from './mcpOAuthRefresh.mjs'

const encrypt = (value: string): Buffer => Buffer.from(value, 'utf8').map((byte) => byte ^ 0xa5)
const decrypt = (value: Buffer): string => Buffer.from(value).map((byte) => byte ^ 0xa5).toString('utf8')
const ACCESS = 'access.refresh-test'
const REFRESH = 'refresh.refresh-test'
const ROTATED = 'refresh.rotated-test'
const OWNER = 'owner-refresh-test'
const binding = (connectionId = 'connection-refresh-test') => ({
  tenantId: 'tenant-refresh-test', connectionId, endpoint: 'https://mcp.example.test/agent',
})
const grant = (overrides: Record<string, unknown> = {}) => {
  const value: Record<string, unknown> = {
    issuer: 'https://login.example.test/tenant',
    tokenEndpoint: 'https://login.example.test/token',
    clientId: 'desktop-client',
    resource: 'https://mcp.example.test/agent',
    scopes: ['records:read', 'offline_access'],
    accessToken: ACCESS,
    expiresAt: 1_000,
    refreshToken: REFRESH,
  }
  for (const [key, item] of Object.entries(overrides)) {
    if (item === undefined) delete value[key]
    else value[key] = item
  }
  return value
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

async function vaultFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'agent-commons-oauth-refresh-'))
  const filePath = join(directory, MCP_CREDENTIAL_FILE)
  const vault = await openMcpCredentialVault({ filePath, encrypt, decrypt, now: () => 10 })
  return { directory, filePath, vault, reopen: () => openMcpCredentialVault({ filePath, encrypt, decrypt, now: () => 11 }) }
}

async function withFixture(run: (context: Awaited<ReturnType<typeof vaultFixture>>) => Promise<void>) {
  const context = await vaultFixture()
  try { await run(context) } finally { await rm(context.directory, { recursive: true, force: true }) }
}

function tokenReply(overrides: Record<string, unknown> = {}) {
  return Object.fromEntries(Object.entries({ access_token: 'access.rotated-test', token_type: 'Bearer', expires_in: 3_600, scope: 'records:read offline_access', refresh_token: ROTATED, ...overrides }).filter(([, value]) => value !== undefined))
}

function errorCode(expected: string) {
  return (error: unknown) => error instanceof McpOAuthRefreshError && error.code === expected
}

test('valid access tokens return only after each caller current-scope fence; unknown expiry is never refreshed', async () => {
  await withFixture(async ({ vault }) => {
    const target = binding()
    const reference = await vault.provisionOAuth(target, OWNER, grant({ expiresAt: null, refreshToken: undefined }))
    let calls = 0
    const manager = createMcpOAuthRefreshManager({ vault, now: () => 5_000, exchange: async () => { calls += 1; return tokenReply() } })
    try {
      assert.equal(await manager.resolve(reference, target, OWNER, { isCurrent: () => true }), ACCESS)
      await assert.rejects(manager.resolve(reference, target, OWNER, { isCurrent: () => false }), errorCode('stale'))
      await assert.rejects(manager.resolve(reference, target, OWNER, { isCurrent: async () => true }), errorCode('stale'))
      await assert.rejects(manager.resolve(reference, target, OWNER, { isCurrent: () => { throw new Error('secret scope detail') } }), errorCode('stale'))
      assert.equal(calls, 0)
    } finally { manager.close() }
  })
})

test('expired grants refresh once for identical coalesced callers and durably rotate refresh tokens', async () => {
  await withFixture(async ({ vault }) => {
    const target = binding()
    const reference = await vault.provisionOAuth(target, OWNER, grant())
    const gate = deferred<Record<string, unknown>>()
    const dispatched = deferred<void>()
    let calls = 0
    let dispatches = 0
    const manager = createMcpOAuthRefreshManager({
      vault, now: () => 1_000,
      exchange: async (request, { beforeDispatch }) => {
        calls += 1
        assert.equal(new URLSearchParams(request.body).get('refresh_token'), REFRESH)
        await beforeDispatch(); dispatches += 1; dispatched.resolve()
        return gate.promise
      },
    })
    try {
      const first = manager.resolve(reference, target, OWNER, { isCurrent: () => true })
      const second = manager.resolve(reference, target, OWNER, { isCurrent: () => true })
      await dispatched.promise
      gate.resolve(tokenReply())
      assert.deepEqual(await Promise.all([first, second]), ['access.rotated-test', 'access.rotated-test'])
      assert.equal(calls, 1)
      assert.equal(dispatches, 1)
      const saved = await vault.readOAuth(reference, target, OWNER)
      assert.equal(saved.state, 'ready')
      assert.equal(saved.grant.accessToken, 'access.rotated-test')
      assert.equal(saved.grant.refreshToken, ROTATED)
      assert.equal(saved.grant.expiresAt, 3_601_000)
    } finally { manager.close() }
  })
})

test('different connection revisions cannot join an in-flight native refresh', async () => {
  await withFixture(async ({ vault }) => {
    const target = binding()
    const reference = await vault.provisionOAuth(target, OWNER, grant())
    const started = deferred<void>()
    const response = deferred<Record<string, unknown>>()
    const manager = createMcpOAuthRefreshManager({ vault, now: () => 1_000,
      exchange: async (_request, { beforeDispatch, isCurrent }) => {
        assert.equal(isCurrent(), true)
        beforeDispatch(); started.resolve()
        return response.promise
      } })
    try {
      const first = manager.resolve(reference, target, OWNER, { isCurrent: () => true, connectionRevision: 1 })
      await started.promise
      await assert.rejects(manager.resolve(reference, target, OWNER, { isCurrent: () => true, connectionRevision: 2 }), errorCode('reauthorization'))
      response.resolve(tokenReply())
      assert.equal(await first, 'access.rotated-test')
    } finally { response.resolve(tokenReply()); manager.close() }
  })
})

test('an omitted replacement refresh token preserves the encrypted prior token', async () => {
  await withFixture(async ({ vault }) => {
    const target = binding()
    const reference = await vault.provisionOAuth(target, OWNER, grant())
    let now = 1_000
    let calls = 0
    const manager = createMcpOAuthRefreshManager({
      vault, now: () => now,
      exchange: async (_request, { beforeDispatch }) => {
        calls += 1
        await beforeDispatch()
        return tokenReply({ refresh_token: undefined })
      },
    })
    try {
      assert.equal(await manager.resolve(reference, target, OWNER, { isCurrent: () => true }), 'access.rotated-test')
      now = 3_601_000
      assert.equal(await manager.resolve(reference, target, OWNER, { isCurrent: () => true }), 'access.rotated-test')
      assert.equal(calls, 2)
      const saved = await vault.readOAuth(reference, target, OWNER)
      assert.equal(saved.grant.refreshToken, REFRESH)
    } finally { manager.close() }
  })
})

test('expired grants without refresh tokens require reauthorization without network I/O', async () => {
  await withFixture(async ({ vault }) => {
    const target = binding()
    const reference = await vault.provisionOAuth(target, OWNER, grant({ refreshToken: undefined }))
    let calls = 0
    const manager = createMcpOAuthRefreshManager({ vault, now: () => 1_000, exchange: async () => { calls += 1; return tokenReply() } })
    try {
      await assert.rejects(manager.resolve(reference, target, OWNER, { isCurrent: () => true }), errorCode('reauthorization'))
      assert.equal(calls, 0)
      assert.equal((await vault.readOAuth(reference, target, OWNER)).state, 'ready', 'expiry without a refresh token does not mutate the stored grant')
    } finally { manager.close() }
  })
})

test('refresh reservations survive manager restart and are never replayed after uncertain dispatch', async () => {
  await withFixture(async ({ vault, reopen }) => {
    const target = binding()
    const reference = await vault.provisionOAuth(target, OWNER, grant())
    const dispatched = deferred<void>()
    const response = deferred<Record<string, unknown>>()
    let calls = 0
    let exchangeSignal: AbortSignal | undefined
    const manager = createMcpOAuthRefreshManager({
      vault, now: () => 1_000,
      exchange: async (_request, options) => {
        calls += 1; exchangeSignal = options.signal
        await options.beforeDispatch(); dispatched.resolve()
        return response.promise
      },
    })
    const pending = manager.resolve(reference, target, OWNER, { isCurrent: () => true })
    await dispatched.promise
    assert.equal((await vault.readOAuth(reference, target, OWNER)).state, 'refreshing')
    manager.close()
    assert.equal(exchangeSignal?.aborted, true)
    response.resolve(tokenReply())
    await assert.rejects(pending)

    const restartedVault = await reopen()
    let replayCalls = 0
    const restarted = createMcpOAuthRefreshManager({ vault: restartedVault, now: () => 1_000, exchange: async () => { replayCalls += 1; return tokenReply() } })
    try {
      await assert.rejects(restarted.resolve(reference, target, OWNER, { isCurrent: () => true }), errorCode('reauthorization'))
      assert.equal(replayCalls, 0)
      assert.equal((await restartedVault.readOAuth(reference, target, OWNER)).state, 'reauthorization-required')
    } finally { restarted.close() }
    await Promise.resolve()
    assert.equal(calls, 1)
  })
})

test('binding, owner and scope-widening mismatches fail closed without returning or storing a token', async () => {
  await withFixture(async ({ vault }) => {
    const target = binding()
    const reference = await vault.provisionOAuth(target, OWNER, grant())
    let calls = 0
    const manager = createMcpOAuthRefreshManager({
      vault, now: () => 1_000,
      exchange: async (_request, { beforeDispatch }) => { calls += 1; await beforeDispatch(); return tokenReply({ scope: 'records:read admin' }) },
    })
    try {
      await assert.rejects(manager.resolve(reference, { ...target, connectionId: 'other-connection' }, OWNER, { isCurrent: () => true }))
      await assert.rejects(manager.resolve(reference, target, 'other-owner', { isCurrent: () => true }))
      await assert.rejects(manager.resolve(reference, target, OWNER, { isCurrent: () => true }))
      assert.equal(calls, 1, 'only the correct binding/owner is allowed to reach exchange')
      const saved = await vault.readOAuth(reference, target, OWNER)
      assert.equal(saved.state, 'reauthorization-required', 'a rejected post-reservation response requires a fresh sign-in')
      assert.equal('grant' in saved, false, 'the prior access and refresh tokens were erased before dispatch')
    } finally { manager.close() }
  })
})

test('malformed token replies fail with a fixed secret-free error and never publish the access token', async () => {
  await withFixture(async ({ vault }) => {
    const target = binding()
    const reference = await vault.provisionOAuth(target, OWNER, grant())
    const secret = 'private-refresh-response-secret'
    const manager = createMcpOAuthRefreshManager({
      vault, now: () => 1_000,
      exchange: async (_request, { beforeDispatch }) => { await beforeDispatch(); return { error: 'invalid_grant', error_description: secret } },
    })
    try {
      await assert.rejects(manager.resolve(reference, target, OWNER, { isCurrent: () => true }), (error: unknown) => {
        assert.ok(error instanceof McpOAuthRefreshError)
        assert.equal(error.code, 'reauthorization')
        assert.equal(error.message.includes(secret), false)
        return true
      })
      const saved = await vault.readOAuth(reference, target, OWNER)
      assert.equal(saved.state, 'reauthorization-required')
      assert.equal('grant' in saved, false)
    } finally { manager.close() }
  })
})

test('each coalesced waiter owns its scope fence and abort does not cancel the shared exchange', async () => {
  await withFixture(async ({ vault }) => {
    const target = binding()
    const reference = await vault.provisionOAuth(target, OWNER, grant())
    const response = deferred<Record<string, unknown>>()
    const dispatched = deferred<void>()
    let signal: AbortSignal | undefined
    let calls = 0
    const manager = createMcpOAuthRefreshManager({
      vault, now: () => 1_000,
      exchange: async (_request, options) => { calls += 1; signal = options.signal; await options.beforeDispatch(); dispatched.resolve(); return response.promise },
    })
    const abort = new AbortController()
    try {
      const cancelled = manager.resolve(reference, target, OWNER, { isCurrent: () => true, signal: abort.signal })
      const survivor = manager.resolve(reference, target, OWNER, { isCurrent: () => true })
      await dispatched.promise
      abort.abort()
      await assert.rejects(cancelled)
      assert.equal(signal?.aborted, false, 'one waiter abort does not cancel another waiter’s work')
      response.resolve(tokenReply())
      assert.equal(await survivor, 'access.rotated-test')
      assert.equal(calls, 1)
    } finally { manager.close() }
  })
})

test('coalesced callers recheck their own synchronous scope after shared exchange completes', async () => {
  await withFixture(async ({ vault }) => {
    const target = binding('waiter-scope-fence')
    const reference = await vault.provisionOAuth(target, OWNER, grant())
    const response = deferred<Record<string, unknown>>()
    const dispatched = deferred<void>()
    let staleWaiterCurrent = true
    const manager = createMcpOAuthRefreshManager({
      vault, now: () => 1_000,
      exchange: async (_request, { beforeDispatch }) => { await beforeDispatch(); dispatched.resolve(); return response.promise },
    })
    try {
      const currentWaiter = manager.resolve(reference, target, OWNER, { isCurrent: () => true })
      const staleWaiter = manager.resolve(reference, target, OWNER, { isCurrent: () => staleWaiterCurrent })
      await dispatched.promise
      staleWaiterCurrent = false
      response.resolve(tokenReply())
      assert.equal(await currentWaiter, 'access.rotated-test')
      await assert.rejects(staleWaiter, errorCode('stale'))
      assert.equal((await vault.readOAuth(reference, target, OWNER)).grant.accessToken, 'access.rotated-test', 'one stale waiter cannot cancel valid shared custody completion')
    } finally { manager.close() }
  })
})

test('host cancellation and close abort exchange, and a late response cannot return a token', async () => {
  await withFixture(async ({ vault }) => {
    const target = binding()
    const reference = await vault.provisionOAuth(target, OWNER, grant())
    const response = deferred<Record<string, unknown>>()
    const dispatched = deferred<void>()
    let signal: AbortSignal | undefined
    const manager = createMcpOAuthRefreshManager({
      vault, now: () => 1_000,
      exchange: async (_request, options) => { signal = options.signal; await options.beforeDispatch(); dispatched.resolve(); return response.promise },
    })
    const pending = manager.resolve(reference, target, OWNER, { isCurrent: () => true })
    await dispatched.promise
    manager.cancel(reference)
    assert.equal(signal?.aborted, true)
    response.resolve(tokenReply())
    await assert.rejects(pending)
    await Promise.resolve()
    await assert.rejects(manager.resolve(reference, target, OWNER, { isCurrent: () => true }))
    manager.close()
  })
})

test('deadline includes vault wait and unsettled underlying work continues to count against maxPending', async () => {
  await withFixture(async ({ vault }) => {
    const first = binding('deadline-one')
    const second = binding('deadline-two')
    const firstReference = await vault.provisionOAuth(first, OWNER, grant())
    const secondReference = await vault.provisionOAuth(second, OWNER, grant())
    const readGate = deferred<unknown>()
    const originalRead = vault.readOAuth.bind(vault)
    let firstReadStarted!: () => void
    const started = new Promise<void>((resolve) => { firstReadStarted = resolve })
    let firstRead = true
    const delayedVault = Object.create(vault)
    delayedVault.readOAuth = (...args: unknown[]) => {
      if (firstRead) { firstRead = false; firstReadStarted(); return readGate.promise }
      return originalRead(...args)
    }
    let calls = 0
    const manager = createMcpOAuthRefreshManager({ vault: delayedVault, now: () => 1_000, timeoutMs: 5, maxPending: 1, exchange: async () => { calls += 1; return tokenReply() } })
    try {
      const pending = manager.resolve(firstReference, first, OWNER, { isCurrent: () => true })
      await started
      await assert.rejects(pending, errorCode('timeout'))
      await assert.rejects(manager.resolve(secondReference, second, OWNER, { isCurrent: () => true }), errorCode('busy'))
      readGate.resolve(await originalRead(firstReference, first, OWNER))
      await assert.rejects(manager.resolve(secondReference, second, OWNER, { isCurrent: () => true }), errorCode('busy'))
      assert.equal(calls, 0)
    } finally { manager.close() }
  })
})

test('a caller that becomes stale during vault wait or exchange never receives or publishes access tokens', async () => {
  await withFixture(async ({ vault }) => {
    const target = binding()
    const reference = await vault.provisionOAuth(target, OWNER, grant())
    const readGate = deferred<unknown>()
    const originalRead = vault.readOAuth.bind(vault)
    let began!: () => void
    const started = new Promise<void>((resolve) => { began = resolve })
    const wrappedVault = Object.create(vault)
    wrappedVault.readOAuth = (...args: unknown[]) => { began(); return readGate.promise }
    let current = true
    let exchanges = 0
    const manager = createMcpOAuthRefreshManager({
      vault: wrappedVault, now: () => 1_000,
      exchange: async (_request, { beforeDispatch }) => { exchanges += 1; await beforeDispatch(); return tokenReply() },
    })
    try {
      const pending = manager.resolve(reference, target, OWNER, { isCurrent: () => current })
      await started
      current = false
      readGate.resolve(await originalRead(reference, target, OWNER))
      await assert.rejects(pending, errorCode('stale'))
      assert.equal(exchanges, 0)
    } finally { manager.close() }
  })

  await withFixture(async ({ vault }) => {
    const target = binding('stale-after-exchange')
    const reference = await vault.provisionOAuth(target, OWNER, grant())
    const response = deferred<Record<string, unknown>>()
    const dispatched = deferred<void>()
    let current = true
    const manager = createMcpOAuthRefreshManager({
      vault, now: () => 1_000,
      exchange: async (_request, { beforeDispatch }) => { await beforeDispatch(); dispatched.resolve(); return response.promise },
    })
    try {
      const pending = manager.resolve(reference, target, OWNER, { isCurrent: () => current })
      await dispatched.promise
      current = false
      response.resolve(tokenReply())
      await assert.rejects(pending, errorCode('stale'))
      const saved = await vault.readOAuth(reference, target, OWNER)
      assert.equal(saved.state, 'reauthorization-required')
      assert.equal('grant' in saved, false)
    } finally { manager.close() }
  })
})

test('exchange must invoke the durable-dispatch barrier exactly once before returning a token', async () => {
  await withFixture(async ({ vault }) => {
    const target = binding()
    const reference = await vault.provisionOAuth(target, OWNER, grant())
    const manager = createMcpOAuthRefreshManager({ vault, now: () => 1_000, exchange: async () => tokenReply() })
    try {
      await assert.rejects(manager.resolve(reference, target, OWNER, { isCurrent: () => true }))
      const saved = await vault.readOAuth(reference, target, OWNER)
      assert.equal(saved.state, 'reauthorization-required')
      assert.equal('grant' in saved, false)
    } finally { manager.close() }
  })
})

test('a caller that turns stale while waiting in the serialized reservation queue cannot erase its prior grant', async () => {
  await withFixture(async ({ vault }) => {
    const target = binding('stale-reservation-queue')
    const reference = await vault.provisionOAuth(target, OWNER, grant())
    const current = { value: true }
    const queued = deferred<void>()
    const release = deferred<void>()
    const realReserve = vault.reserveOAuthRefresh.bind(vault)
    const queuedVault = Object.create(vault)
    queuedVault.reserveOAuthRefresh = async (...args: unknown[]) => {
      queued.resolve()
      await release.promise
      return realReserve(...args)
    }
    let exchanges = 0
    const manager = createMcpOAuthRefreshManager({
      vault: queuedVault,
      now: () => 1_000,
      exchange: async () => { exchanges += 1; return tokenReply() },
    })
    try {
      const pending = manager.resolve(reference, target, OWNER, { isCurrent: () => current.value })
      await queued.promise
      current.value = false
      release.resolve()
      await assert.rejects(pending, errorCode('stale'))
      assert.equal(exchanges, 0)
      const saved = await vault.readOAuth(reference, target, OWNER)
      assert.equal(saved.state, 'ready')
      assert.equal(saved.grant.accessToken, ACCESS)
      assert.equal(saved.grant.refreshToken, REFRESH)
    } finally { manager.close() }
  })
})

test('coalescing admits at most 64 callers even while one unknown-expiry read is stalled', async () => {
  await withFixture(async ({ vault }) => {
    const target = binding('waiter-bound')
    const reference = await vault.provisionOAuth(target, OWNER, grant({ expiresAt: null, refreshToken: undefined }))
    const readGate = deferred<unknown>()
    const originalRead = vault.readOAuth.bind(vault)
    let readStarted!: () => void
    const started = new Promise<void>((resolve) => { readStarted = resolve })
    const delayedVault = Object.create(vault)
    delayedVault.readOAuth = (...args: unknown[]) => { readStarted(); return readGate.promise }
    const manager = createMcpOAuthRefreshManager({
      vault: delayedVault,
      now: () => 1_000,
      maxPending: 1,
      exchange: async () => { throw new Error('unknown-expiry credentials must not refresh') },
    })
    try {
      const callers = Array.from({ length: 64 }, () => manager.resolve(reference, target, OWNER, { isCurrent: () => true }))
      await started
      await assert.rejects(manager.resolve(reference, target, OWNER, { isCurrent: () => true }), errorCode('busy'))
      readGate.resolve(await originalRead(reference, target, OWNER))
      assert.deepEqual(await Promise.all(callers), Array(64).fill(ACCESS))
    } finally { manager.close() }
  })
})

test('a second beforeDispatch invocation fails closed and never returns an access token', async () => {
  await withFixture(async ({ vault }) => {
    const target = binding('duplicate-dispatch-barrier')
    const reference = await vault.provisionOAuth(target, OWNER, grant())
    let attempts = 0
    const manager = createMcpOAuthRefreshManager({
      vault,
      now: () => 1_000,
      exchange: async (_request, { beforeDispatch }) => {
        await beforeDispatch()
        attempts += 1
        await assert.rejects(beforeDispatch())
        return tokenReply()
      },
    })
    try {
      await assert.rejects(manager.resolve(reference, target, OWNER, { isCurrent: () => true }), errorCode('reauthorization'))
      assert.equal(attempts, 1)
      const saved = await vault.readOAuth(reference, target, OWNER)
      assert.equal(saved.state, 'reauthorization-required')
      assert.equal('grant' in saved, false)
    } finally { manager.close() }
  })
})

test('account loss during post-publication vault completion cannot return the refreshed token', async () => {
  await withFixture(async ({ vault }) => {
    const target = binding('stale-completion-await')
    const reference = await vault.provisionOAuth(target, OWNER, grant())
    const completed = deferred<void>()
    const release = deferred<void>()
    const realComplete = vault.completeOAuthRefresh.bind(vault)
    const delayedVault = Object.create(vault)
    delayedVault.completeOAuthRefresh = async (...args: unknown[]) => {
      await realComplete(...args)
      completed.resolve()
      await release.promise
    }
    let current = true
    const manager = createMcpOAuthRefreshManager({
      vault: delayedVault,
      now: () => 1_000,
      exchange: async (_request, { beforeDispatch }) => { await beforeDispatch(); return tokenReply() },
    })
    try {
      const pending = manager.resolve(reference, target, OWNER, { isCurrent: () => current })
      await completed.promise
      current = false
      release.resolve()
      await assert.rejects(pending, errorCode('stale'))
      const saved = await vault.readOAuth(reference, target, OWNER)
      assert.equal(saved.state, 'ready')
      assert.equal(saved.grant.accessToken, 'access.rotated-test')
    } finally { manager.close() }
  })
})

test('a zero-lifetime refresh response cannot cause repeated automatic exchange', async () => {
  await withFixture(async ({ vault }) => {
    const target = binding()
    const reference = await vault.provisionOAuth(target, OWNER, grant())
    let calls = 0
    const manager = createMcpOAuthRefreshManager({ vault, now: () => 1000,
      exchange: async (_request, { beforeDispatch }) => { calls++; beforeDispatch(); return tokenReply({ expires_in: 0 }) },
    })
    try {
      await assert.rejects(manager.resolve(reference, target, OWNER, { isCurrent: () => true }), errorCode('reauthorization'))
      await assert.rejects(manager.resolve(reference, target, OWNER, { isCurrent: () => true }), errorCode('reauthorization'))
      assert.equal(calls, 1)
      assert.equal((await vault.readOAuth(reference, target, OWNER)).state, 'reauthorization-required')
    } finally { manager.close() }
  })
})

test('cancelled waiters retain their subscription slots until shared work settles', async () => {
  const gate = deferred<unknown>()
  const target = binding()
  const reference = `MCP_DESKTOP_${'A'.repeat(32)}`
  const manager = createMcpOAuthRefreshManager({ vault: { readOAuth: () => gate.promise }, exchange: async () => {}, now: () => 1000 })
  try {
    for (let index = 0; index < 64; index++) {
      const abort = new AbortController()
      const pending = manager.resolve(reference, target, OWNER, { isCurrent: () => true, signal: abort.signal })
      abort.abort()
      await assert.rejects(pending, errorCode('cancelled'))
    }
    const bounded = assert.rejects(manager.resolve(reference, target, OWNER, { isCurrent: () => true }), errorCode('busy'))
    gate.resolve({ state: 'ready', grant: grant({ expiresAt: null }) })
    await bounded
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(await manager.resolve(reference, target, OWNER, { isCurrent: () => true }), ACCESS, 'settlement releases retained subscription capacity')
  } finally { gate.resolve({ state: 'ready', grant: grant({ expiresAt: null }) }); manager.close() }
})
