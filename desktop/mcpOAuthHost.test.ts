import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMcpOAuthHost, McpOAuthHostError } from './mcpOAuthHost.mjs'

const issuer = 'https://login.example.test/tenant'
const endpoint = 'https://mcp.example.test/agent'
const connectionId = 'mcp-connection-owner-test'
const ownerId = 'user-owner-test'
const tenantId = 'tenant-owner-test'
const binding = () => ({ tenantId, connectionId, endpoint })
const connection = (extra: Record<string, unknown> = {}) => ({ id: connectionId, revision: 3, authentication: 'device-oauth',
  inspectionOperationId: null, status: 'unverified', ...extra })
const resource = (extra: Record<string, unknown> = {}) => ({ resource: endpoint, authorizationServers: [issuer],
  scopesSupported: ['files:read', 'files:write'], challengeScopes: ['files:read'], ...extra })
const metadata = { issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`,
  response_types_supported: ['code'], grant_types_supported: ['authorization_code'],
  token_endpoint_auth_methods_supported: ['none'], code_challenge_methods_supported: ['S256'] }
const deferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const hostError = (code: string) => (error: unknown) => error instanceof McpOAuthHostError && error.code === code

function harness(overrides: Record<string, any> = {}) {
  let now = 1_000
  let current = true
  let sourceStamp = 'source-generation-one'
  let currentConnection = connection()
  let id = 0
  const calls: Record<string, any[]> = { resources: [], reviews: [], signIns: [], inspections: [], discards: [] }
  const source = () => ({ stamp: sourceStamp, ownerUserId: ownerId, binding: binding(), connection: currentConnection })
  const discovery = {
    async discoverResource(target: string, options: any) {
      calls.resources.push({ target, options })
      return overrides.discoverResource ? overrides.discoverResource(target, options) : resource()
    },
    async discoverServer(raw: unknown, selectedIssuer: string, options: any) {
      calls.reviews.push({ raw, selectedIssuer, options })
      return overrides.discoverServer ? overrides.discoverServer(raw, selectedIssuer, options) : { issuer, metadata }
    },
  }
  const signIn = { async authorize(input: unknown, options: unknown) {
    calls.signIns.push({ input, options })
    return overrides.authorize ? overrides.authorize(input, options) : { reference: 'native-reference-secret' }
  } }
  const inspect = async (trusted: unknown, request: unknown) => {
    calls.inspections.push({ trusted, request })
    if (overrides.inspect) return overrides.inspect(trusted, request)
    const { operationId } = request as any
    currentConnection = connection({ revision: 4, status: 'connected', inspectionOperationId: operationId })
    return { connection: currentConnection, credentialCleanup: { available: true } }
  }
  const discard = async (reference: string, target: unknown) => {
    calls.discards.push({ reference, target })
    return overrides.discard?.(reference, target)
  }
  const host = createMcpOAuthHost({
    assertCaller: overrides.assertCaller ?? (() => undefined),
    resolveSource: overrides.resolveSource ?? (() => source()),
    isSourceCurrent: overrides.isSourceCurrent ?? (() => current),
    discovery, signIn, inspect, discard,
    now: () => now,
    randomUUID: () => `opaque-id-${++id}`,
  })
  const start = (options: Record<string, unknown> = {}) => host.start({}, { connectionId, expectedRevision: 3,
    source: { tenantId, userId: ownerId }, ...options })
  async function reviewed() {
    const started = await start()
    const review = await host.review({}, { flowId: started.flowId, issuer })
    return { started, review }
  }
  return { host, calls, source, start, reviewed, setCurrent: (value: boolean) => { current = value },
    setStamp: (value: string) => { sourceStamp = value }, setConnection: (value: any) => { currentConnection = value },
    advance: (amount: number) => { now += amount } }
}

test('discovery, issuer review and explicit scopes stay native until exact inspection acknowledgement', async () => {
  const h = harness()
  try {
    const { started, review } = await h.reviewed()
    assert.deepEqual(started, { flowId: 'opaque-id-1', connectionId, revision: 3, authorizationServers: [issuer] })
    assert.deepEqual(review, { flowId: started.flowId, issuer, scopesSupported: ['files:read', 'files:write'], suggestedScopes: ['files:read'] })
    assert.ok(Object.isFrozen(review) && Object.isFrozen(review.scopesSupported) && Object.isFrozen(review.suggestedScopes))
    assert.equal(JSON.stringify(started).includes('native-reference-secret'), false)
    assert.equal(JSON.stringify(review).includes('authorization_endpoint'), false)

    const result = await h.host.authorize({}, { flowId: started.flowId, scopes: ['files:read'] })
    assert.equal(result.status, 'complete')
    assert.deepEqual(result.connection, { id: connectionId, revision: 4, status: 'connected' })
    assert.deepEqual(h.calls.signIns[0].input, { binding: binding(), ownerId, issuer, metadata, scopes: ['files:read'] })
    assert.equal(h.calls.inspections.length, 1)
    assert.equal(h.calls.inspections[0].trusted.connection.revision, 3, 'inspection receives the frozen source revision')
    assert.deepEqual(h.calls.inspections[0].trusted.binding, binding())
    assert.deepEqual(h.calls.inspections[0].request, {
      operationId: 'opaque-id-2', expectedRevision: 3, credentialReference: 'native-reference-secret',
    })
    assert.deepEqual(h.calls.discards, [])
  } finally { h.host.close() }
})

test('source equality is only a precondition; foreign source, stale revision and unadvertised issuer fail closed', async () => {
  const h = harness()
  try {
    await assert.rejects(h.start({ source: { tenantId, userId: 'user-other' } }), hostError('stale'))
    await assert.rejects(h.start({ expectedRevision: 2 }), hostError('conflict'))
    const started = await h.start()
    await assert.rejects(h.host.review({}, { flowId: started.flowId, issuer: 'https://evil.example.test' }), hostError('request'))
    assert.equal(h.calls.reviews.length, 0)
    h.setStamp('source-generation-two')
    await assert.rejects(h.host.review({}, { flowId: started.flowId, issuer }), hostError('stale'))
    assert.equal(h.calls.signIns.length, 0)
  } finally { h.host.close() }
})

test('authorization accepts only explicit unique supported scopes, and missing metadata scopes allows only empty', async () => {
  const h = harness({ discoverResource: async () => resource({ scopesSupported: undefined, challengeScopes: ['files:read'] }) })
  try {
    const { started, review } = await h.reviewed()
    assert.deepEqual(review.scopesSupported, [])
    assert.deepEqual(review.suggestedScopes, [])
    await assert.rejects(h.host.authorize({}, { flowId: started.flowId, scopes: ['files:read'] }), hostError('request'))
    const result = await h.host.authorize({}, { flowId: started.flowId, scopes: [] })
    assert.equal(result.status, 'complete')
    assert.deepEqual(h.calls.signIns[0].input.scopes, [])
  } finally { h.host.close() }

  const other = harness()
  try {
    const { started } = await other.reviewed()
    await assert.rejects(other.host.authorize({}, { flowId: started.flowId, scopes: ['files:delete'] }), hostError('request'))
    await assert.rejects(other.host.authorize({}, { flowId: started.flowId, scopes: ['files:read', 'files:read'] }), hostError('request'))
    assert.equal(other.calls.signIns.length, 0)
  } finally { other.host.close() }

  const intersect = harness({
    discoverServer: async () => ({ issuer, metadata, scopesSupported: ['files:read', 'provider:admin'] }),
  })
  try {
    const { started, review } = await intersect.reviewed()
    assert.deepEqual(review.scopesSupported, ['files:read'], 'both metadata declarations narrow the explicit choice')
    await assert.rejects(intersect.host.authorize({}, { flowId: started.flowId, scopes: ['provider:admin'] }), hostError('request'))
  } finally { intersect.host.close() }

  const authServerOnly = harness({
    discoverResource: async () => resource({ scopesSupported: undefined }),
    discoverServer: async () => ({ issuer, metadata, scopesSupported: ['files:read'] }),
  })
  try {
    const { started, review } = await authServerOnly.reviewed()
    assert.deepEqual(review.scopesSupported, ['files:read'])
    assert.equal((await authServerOnly.host.authorize({}, { flowId: started.flowId, scopes: ['files:read'] })).status, 'complete')
  } finally { authServerOnly.host.close() }
})

test('uncertain inspection retains only the exact native reference and reconcile replays without a new sign-in', async () => {
  let first = true
  const h = harness({ inspect: async (_source, _request) => {
    if (first) { first = false; throw new Error('private transport failure') }
    const operationId = _request.operationId
    const resultConnection = connection({ revision: 4, status: 'connected', inspectionOperationId: operationId })
    h.setConnection(resultConnection)
    return { connection: resultConnection }
  } })
  try {
    const { started } = await h.reviewed()
    const pending = await h.host.authorize({}, { flowId: started.flowId, scopes: ['files:read'] })
    assert.deepEqual(pending, { status: 'inspection-pending', flowId: started.flowId })
    assert.equal(h.calls.discards.length, 0)
    const result = await h.host.reconcile({}, { flowId: started.flowId })
    assert.equal(result.status, 'complete')
    assert.equal(h.calls.signIns.length, 1)
    assert.equal(h.calls.inspections.length, 2)
    assert.equal(h.calls.inspections[1].request.operationId, h.calls.inspections[0].request.operationId)
    assert.equal(h.calls.inspections[1].request.credentialReference, 'native-reference-secret')
  } finally { h.host.close() }
})

test('a stale inspection response cannot override a fresh source read with a different operation receipt', async () => {
  const h = harness({ inspect: async (_source: unknown, request: any) => {
    h.setConnection(connection({ revision: 4, inspectionOperationId: 'another-operation' }))
    return { connection: connection({ revision: 4, status: 'connected', inspectionOperationId: request.operationId }) }
  } })
  try {
    const { started } = await h.reviewed()
    const result = await h.host.authorize({}, { flowId: started.flowId, scopes: ['files:read'] })
    assert.deepEqual(result, { status: 'inspection-pending', flowId: started.flowId })
    assert.equal(h.calls.discards.length, 0, 'a submitted reference remains for recovery even after unrelated current truth')
  } finally { h.host.close() }
})

test('reconcile returns the already durable exact receipt or remains pending after an unrelated revision', async () => {
  let mode: 'receipt' | 'changed' = 'receipt'
  const h = harness({ inspect: async () => { throw new Error('lost response') } })
  try {
    const { started } = await h.reviewed()
    await h.host.authorize({}, { flowId: started.flowId, scopes: ['files:read'] })
    const operationId = h.calls.inspections[0].request.operationId
    if (mode === 'receipt') h.setConnection(connection({ revision: 4, inspectionOperationId: operationId }))
    const already = await h.host.reconcile({}, { flowId: started.flowId })
    assert.equal(already.status, 'complete')
    assert.equal(h.calls.inspections.length, 1, 'durable exact receipt is read, not replayed')
  } finally { h.host.close() }

  mode = 'changed'
  const other = harness({ inspect: async () => { throw new Error('lost response') } })
  try {
    const { started } = await other.reviewed()
    await other.host.authorize({}, { flowId: started.flowId, scopes: ['files:read'] })
    other.setConnection(connection({ revision: 4, inspectionOperationId: 'different-operation' }))
    const pending = await other.host.reconcile({}, { flowId: started.flowId })
    assert.deepEqual(pending, { status: 'inspection-pending', flowId: started.flowId })
    assert.equal(other.calls.inspections.length, 1, 'no rebase or second logical mutation after revision changed')
    assert.equal(other.calls.signIns.length, 1)
    assert.equal(other.calls.discards.length, 0)
  } finally { other.host.close() }
})

test('submitted recovery reservation expires boundedly without deleting its possibly committed credential', async () => {
  const h = harness({ inspect: async () => { throw new Error('lost response') } })
  try {
    const { started } = await h.reviewed()
    assert.deepEqual(await h.host.authorize({}, { flowId: started.flowId, scopes: ['files:read'] }),
      { status: 'inspection-pending', flowId: started.flowId })
    h.advance(600_000)
    await assert.rejects(h.host.reconcile({}, { flowId: started.flowId }), hostError('expired'))
    assert.equal(h.calls.inspections.length, 1, 'expired recovery never resubmits or rebases')
    assert.equal(h.calls.discards.length, 0, 'submitted credential is never discarded on recovery expiry')
    const next = await h.start()
    assert.equal(next.connectionId, connectionId, 'the bounded in-memory reservation is released after recovery expiry')
  } finally { h.host.close() }
})

test('one flow per connection is retained while discovery ignores cancellation', async () => {
  const gate = deferred<any>()
  const startedWork = deferred<any>()
  const h = harness({ discoverResource: async (_endpoint: string, options: any) => { startedWork.resolve(options); return gate.promise } })
  try {
    const first = h.start()
    const options = await startedWork.promise
    await assert.rejects(h.start(), hostError('busy'))
    h.host.close()
    assert.equal(options.signal.aborted, true)
    gate.resolve(resource())
    await assert.rejects(first, hostError('cancelled'))
    assert.equal(h.calls.signIns.length, 0)
  } finally { h.host.close() }
})

test('the global eight-flow limit counts independent active discovery operations', async () => {
  const ids = Array.from({ length: 9 }, (_, index) => `mcp-connection-${index}`)
  const pendingGates = Array.from({ length: 8 }, () => deferred<any>())
  let callIndex = 0
  const discoveryOptions: any[] = []
  const bounded = createMcpOAuthHost({
    assertCaller() {},
    async resolveSource(id: string) {
      if (!ids.includes(id)) throw new Error('unknown')
      return { stamp: 'same-window', ownerUserId: ownerId,
        binding: { tenantId, connectionId: id, endpoint },
        connection: { id, revision: 0, authentication: 'device-oauth', status: 'unverified' } }
    },
    isSourceCurrent: () => true,
    discovery: {
      discoverResource(_target: string, options: any) {
        discoveryOptions.push(options)
        return pendingGates[callIndex++]!.promise
      },
      async discoverServer() { return { issuer, metadata } },
    },
    signIn: { async authorize() { return { reference: 'unused' } } },
    async inspect() { throw new Error('unused') }, async discard() {}, now: () => 1_000,
    randomUUID: (() => { let n = 0; return () => `bounded-flow-${++n}` })(),
  })
  try {
    const operations = ids.slice(0, 8).map(id => bounded.start({}, { connectionId: id, expectedRevision: 0,
      source: { tenantId, userId: ownerId } }))
    while (discoveryOptions.length < 8) await new Promise(resolve => setImmediate(resolve))
    await assert.rejects(bounded.start({}, { connectionId: ids[8], expectedRevision: 0,
      source: { tenantId, userId: ownerId } }), hostError('busy'))
    bounded.close()
    pendingGates.forEach(gate => gate.resolve(resource()))
    const settled = await Promise.allSettled(operations)
    assert.ok(settled.every(item => item.status === 'rejected'))
  } finally { bounded.close() }
})

test('cancellation during sign-in waits for abort-ignoring work, discards only its unused ref and never inspects', async () => {
  const gate = deferred<any>()
  const begun = deferred<void>()
  const h = harness({ authorize: async () => { begun.resolve(); return gate.promise } })
  try {
    const { started } = await h.reviewed()
    const auth = h.host.authorize({}, { flowId: started.flowId, scopes: ['files:read'] })
    await begun.promise
    const cancellation = h.host.cancel({}, { flowId: started.flowId })
    assert.deepEqual(await cancellation, { status: 'cancelled' }, 'cancel responds without waiting for abort-ignoring sign-in')
    await assert.rejects(h.start(), hostError('busy'), 'the unsettled native sign-in still owns its flow reservation')
    gate.resolve({ reference: 'unused-provisional-reference' })
    await assert.rejects(auth, hostError('cancelled'))
    assert.equal(h.calls.inspections.length, 0)
    assert.deepEqual(h.calls.discards.map(row => row.reference), ['unused-provisional-reference'])
  } finally { h.host.close() }
})

test('post-submit cancellation and account loss retain an inspection recovery handle and never discard the reference', async () => {
  const inspectGate = deferred<any>()
  const inspectStarted = deferred<void>()
  const h = harness({ inspect: async () => { inspectStarted.resolve(); return inspectGate.promise } })
  try {
    const { started } = await h.reviewed()
    const authorization = h.host.authorize({}, { flowId: started.flowId, scopes: ['files:read'] })
    await inspectStarted.promise
    assert.deepEqual(await h.host.cancel({}, { flowId: started.flowId }), { status: 'inspection-pending', flowId: started.flowId })
    h.setCurrent(false)
    inspectGate.resolve({ connection: connection({ revision: 4, inspectionOperationId: h.calls.inspections[0].request.operationId }) })
    assert.deepEqual(await authorization, { status: 'inspection-pending', flowId: started.flowId })
    assert.equal(h.calls.discards.length, 0)
  } finally { h.host.close() }
})

test('expired pre-submit flows are unusable, and closed hosts reject without exposing dependency errors', async () => {
  const h = harness({ assertCaller: () => { throw new Error('private sender detail') } })
  try { await assert.rejects(h.start(), error => {
    assert.ok(error instanceof McpOAuthHostError)
    assert.equal(error.message.includes('private sender detail'), false)
    return true
  }) } finally { h.host.close() }

  const normal = harness()
  try {
    const started = await normal.start()
    normal.advance(180_000)
    await assert.rejects(normal.host.review({}, { flowId: started.flowId, issuer }), hostError('expired'))
  } finally { normal.host.close() }
  await assert.rejects(normal.host.start({}, { connectionId, expectedRevision: 3, source: { tenantId, userId: ownerId } }), hostError('cancelled'))
})

test('async trusted-source resolution is fenced before and after each stage', async () => {
  const gate = deferred<any>()
  const entered = deferred<void>()
  let current = true
  const h = harness({ resolveSource: async () => { entered.resolve(); return gate.promise }, isSourceCurrent: () => current })
  try {
    const starting = h.start()
    await entered.promise
    current = false
    gate.resolve(h.source())
    await assert.rejects(starting, hostError('stale'))
    assert.equal(h.calls.resources.length, 0, 'no discovery I/O after stale async source resolution')
  } finally { h.host.close() }

  const changed = harness({ resolveSource: async () => {
    const value = changed.source()
    return { ...value, connection: { ...value.connection, revision: 4 } }
  } })
  try {
    await assert.rejects(changed.start(), hostError('conflict'))
    assert.equal(changed.calls.resources.length, 0, 'a newly observed revision is never silently rebased')
  } finally { changed.host.close() }

  const revisionGate = deferred<any>()
  const revisionRead = deferred<void>()
  let reads = 0
  const revision = harness({ resolveSource: async () => {
    reads += 1
    if (reads === 2) { revisionRead.resolve(); await revisionGate.promise }
    return revision.source()
  } })
  try {
    const starting = revision.start()
    await revisionRead.promise
    revision.setConnection(connection({ revision: 4 }))
    revisionGate.resolve(undefined)
    await assert.rejects(starting, hostError('conflict'))
    assert.equal(revision.calls.resources.length, 0, 'revision drift during awaited source read prevents discovery')
  } finally { revision.host.close() }
})
