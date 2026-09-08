import { test } from 'node:test'
import assert from 'node:assert/strict'
import { refreshAccount } from './account.ts'
import { peek, setData } from './cache.ts'
import {
  applyMcpConnectionMutation,
  McpCredentialCleanupPendingError,
  McpCredentialCleanupUncertainError,
  reconcileMcpConnectionMutation,
} from './mcpConnectionCommands.ts'
import { getMcpConnection, listMcpConnections } from './mcpConnectionReads.ts'
import { keys } from './keys.ts'
import type { McpConnectionListResponse, McpConnectionView } from '../../contract/mcpConnections.ts'
import { createAcknowledgedActionMutationController } from '../controller/acknowledgedActionMutationCore.ts'
import type { RevisionedMutationStatus } from '../controller/revisionedMutationCore.ts'

const view: McpConnectionView = {
  id: 'mcp-connection-' + 'a'.repeat(32), label: 'Server', status: 'connected', revision: 2,
  authentication: 'none', protocolVersion: '2025-06-18', inspectedAt: 1, tools: [], execution: 'unavailable',
}

const list = (): McpConnectionListResponse => ({
  connections: [view],
  capabilities: { deviceBearerCredentials: false, loopbackConnections: false, credentialCleanupPending: false },
})

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json', 'x-resolved-tenant': 'mcp-tenant' },
  })
}

test('MCP mutation responses retain cleanup pending, including removed:false acknowledgements', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch; refreshAccount(null) })
  refreshAccount({ userId: 'mcp-user', tenantId: 'mcp-tenant' })
  setData(keys.mcpConnections, list())
  const responses = [
    jsonResponse({ removed: false, credentialCleanup: 'pending' }),
    jsonResponse({ removed: false, credentialCleanup: 'complete' }),
  ]
  const methods: string[] = []
  globalThis.fetch = async (_input, init) => {
    methods.push(init?.method ?? 'GET')
    return responses.shift()!
  }
  const intent = { kind: 'remove' as const, tenantId: 'mcp-tenant', id: view.id, expectedRevision: view.revision }
  await assert.rejects(
    applyMcpConnectionMutation(intent, 'remove-once'),
    (error: unknown) => error instanceof McpCredentialCleanupPendingError,
  )
  assert.equal(peek<McpConnectionListResponse>(keys.mcpConnections)?.capabilities.credentialCleanupPending, true)
  await applyMcpConnectionMutation(intent, 'remove-retry')
  assert.equal(peek<McpConnectionListResponse>(keys.mcpConnections)?.capabilities.credentialCleanupPending, false)
  assert.deepEqual(methods, ['DELETE', 'DELETE'])
})

test('acknowledged removal holds the reviewed row through pending cleanup and retries the exact act', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch; refreshAccount(null) })
  refreshAccount({ userId: 'mcp-user', tenantId: 'mcp-tenant' })
  const responses = [
    jsonResponse({ removed: true, credentialCleanup: 'pending' }),
    jsonResponse({ error: { code: 'not_found', message: 'missing' } }, 404),
    jsonResponse({ error: { code: 'not_found', message: 'missing' } }, 404),
    jsonResponse({ removed: false, credentialCleanup: 'complete' }),
  ]
  const calls: Array<{ method: string; key: string | null }> = []
  globalThis.fetch = async (_input, init) => {
    calls.push({ method: init?.method ?? 'GET', key: new Headers(init?.headers).get('Idempotency-Key') })
    return responses.shift()!
  }
  const statuses: RevisionedMutationStatus[] = []
  const intent = { kind: 'remove' as const, tenantId: 'mcp-tenant', id: view.id, expectedRevision: view.revision, reviewed: view }
  const controller = createAcknowledgedActionMutationController<typeof intent, McpConnectionView | undefined>({
    resourceId: () => 'mcp-tenant:' + view.id,
    snapshot: () => view,
    mutate: (input, idempotencyKey) => applyMcpConnectionMutation(input, idempotencyKey),
    reconcile: (input, baseline, idempotencyKey) => reconcileMcpConnectionMutation(input, baseline, idempotencyKey),
    discardReconcileFailure: 'retain',
    describeFailure: (error) => error instanceof McpCredentialCleanupPendingError
      ? { message: 'Server change saved; device credential cleanup remains pending.', retryable: true }
      : { message: 'held', retryable: true },
    setStatus: (status) => statuses.push(status),
    mintIdempotencyKey: () => 'remove-exact-key',
  })
  const result = controller.enqueue(intent)
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  assert.equal(statuses.at(-1)?.error, 'Server change saved; device credential cleanup remains pending.')
  assert.equal(statuses.at(-1)?.pendingCount, 1)
  controller.discard()
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  assert.equal(statuses.at(-1)?.error, 'Server change saved; device credential cleanup remains pending.')
  assert.equal(statuses.at(-1)?.pendingCount, 1, 'Dismiss cannot release an unverified native cleanup')
  controller.retry()
  assert.equal(await result, 'applied')
  assert.deepEqual(calls.map(({ method }) => method), ['DELETE', 'GET', 'GET', 'DELETE'])
  assert.equal(calls[0]?.key, 'remove-exact-key')
  assert.equal(calls[3]?.key, 'remove-exact-key')
})

test('a refused 409 inspection can Dismiss after a bounded read without retaining cleanup uncertainty', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch; refreshAccount(null) })
  refreshAccount({ userId: 'mcp-user', tenantId: 'mcp-tenant' })
  const responses = [
    jsonResponse({ error: { code: 'conflict', message: 'revision conflict' } }, 409),
    jsonResponse(view),
    jsonResponse(view),
  ]
  const methods: string[] = []
  globalThis.fetch = async (_input, init) => {
    methods.push(init?.method ?? 'GET')
    return responses.shift()!
  }
  let cause: unknown
  const statuses: RevisionedMutationStatus[] = []
  const intent = { kind: 'inspect' as const, tenantId: 'mcp-tenant', id: view.id, reviewed: view,
    request: { operationId: 'inspect-refused', expectedRevision: view.revision } }
  const controller = createAcknowledgedActionMutationController<typeof intent, McpConnectionView | undefined>({
    resourceId: () => 'mcp-tenant:' + view.id,
    snapshot: () => view,
    mutate: async (input, key) => {
      try { await applyMcpConnectionMutation(input, key) }
      catch (error) { cause = error; throw error }
    },
    reconcile: (input, baseline, key) => reconcileMcpConnectionMutation(input, baseline, key, cause),
    discardReconcileFailure: 'retain',
    describeFailure: () => ({ message: 'revision conflict', retryable: false }),
    setStatus: (status) => statuses.push(status),
    mintIdempotencyKey: () => 'inspect-refused',
  })
  const result = controller.enqueue(intent)
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  assert.equal(statuses.at(-1)?.error, 'revision conflict')
  controller.discard()
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  assert.equal(await result, 'discarded')
  assert.deepEqual(methods, ['POST', 'GET', 'GET'])
})

test('confirmed upstream inspection refusals can Dismiss without replaying bearer/auth or catalog work', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch; refreshAccount(null) })
  refreshAccount({ userId: 'mcp-user', tenantId: 'mcp-tenant' })
  for (const [label, message] of [
    ['wrong bearer', 'The MCP server refused authentication.'],
    ['invalid catalog', 'The MCP server could not provide a supported, valid tool catalog.'],
  ] as const) {
    const responses = [
      jsonResponse({ error: { code: 'upstream_unavailable', message } }, 502),
      jsonResponse(view),
      jsonResponse(view),
    ]
    const methods: string[] = []
    let cause: unknown
    globalThis.fetch = async (_input, init) => {
      methods.push(init?.method ?? 'GET')
      return responses.shift()!
    }
    const statuses: RevisionedMutationStatus[] = []
    const intent = {
      kind: 'inspect' as const,
      tenantId: 'mcp-tenant',
      id: view.id,
      reviewed: view,
      request: { operationId: `inspect-${label.replaceAll(' ', '-')}`, expectedRevision: view.revision },
    }
    const controller = createAcknowledgedActionMutationController<typeof intent, McpConnectionView | undefined>({
      resourceId: () => 'mcp-tenant:' + view.id,
      snapshot: () => view,
      mutate: async (input, key) => {
        try { await applyMcpConnectionMutation(input, key) }
        catch (error) { cause = error; throw error }
      },
      reconcile: (input, baseline, key) => reconcileMcpConnectionMutation(input, baseline, key, cause),
      discardReconcileFailure: 'retain',
      describeFailure: (error) => error instanceof McpCredentialCleanupPendingError
        ? { message: 'Server change saved; device credential cleanup remains pending.', retryable: true }
        : error instanceof McpCredentialCleanupUncertainError
          ? { message: 'Could not confirm the MCP change or device credential cleanup.', retryable: true }
          : { message: error instanceof Error ? error.message : 'failed', retryable: true },
      setStatus: (status) => statuses.push(status),
      mintIdempotencyKey: () => `inspect-${label}`,
    })
    const result = controller.enqueue(intent)
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    assert.equal(statuses.at(-1)?.error, message, `${label}: original refusal remains actionable`)
    controller.discard()
    assert.equal(await result, 'discarded', `${label}: Dismiss releases a confirmed refusal`)
    assert.deepEqual(methods, ['POST', 'GET', 'GET'], `${label}: Dismiss does not replay inspection`)
    assert.notEqual(statuses.at(-1)?.error, 'Server change saved; device credential cleanup remains pending.')
  }
})

test('a delayed pre-create list cannot drop a row acknowledged while that list was in flight', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch; refreshAccount(null) })
  refreshAccount({ userId: 'mcp-user', tenantId: 'mcp-tenant' })
  let releaseList!: (response: Response) => void
  globalThis.fetch = async (_input, init) => {
    if (init?.method === 'POST') return jsonResponse({ connection: view, created: true })
    return new Promise<Response>((resolve) => { releaseList = resolve })
  }
  const delayed = listMcpConnections()
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  await applyMcpConnectionMutation({
    kind: 'create', tenantId: 'mcp-tenant',
    request: { creationId: 'pre-create-list', label: view.label, endpoint: 'https://mcp.example.test', authentication: 'none' },
  }, 'pre-create-list')
  releaseList(jsonResponse({ connections: [], capabilities: list().capabilities }))
  assert.deepEqual((await delayed).connections.map((connection) => connection.id), [view.id])
})

test('Dismiss/reconcile never replays a create or cleanup side effect', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch; refreshAccount(null) })
  refreshAccount({ userId: 'mcp-user', tenantId: 'mcp-tenant' })
  const calls: string[] = []
  globalThis.fetch = async (input, init) => {
    calls.push(`${init?.method ?? 'GET'} ${String(input)}`)
    return jsonResponse({ error: { code: 'not_found', message: 'missing' } }, 404)
  }

  const created = await reconcileMcpConnectionMutation(
    {
      kind: 'create', tenantId: 'mcp-tenant',
      request: { creationId: 'creation-dismiss', label: 'Server', endpoint: 'https://mcp.example.test', authentication: 'none' },
    },
    undefined,
    'creation-dismiss',
  )
  assert.equal(created, false, 'a missing deterministic row does not justify replaying create during Dismiss')
  await assert.rejects(
    reconcileMcpConnectionMutation(
      { kind: 'remove', tenantId: 'mcp-tenant', id: view.id, expectedRevision: view.revision },
      view,
      'remove-once',
    ),
    (error: unknown) => error instanceof McpCredentialCleanupUncertainError,
    'server absence does not prove native credential cleanup',
  )
  await assert.rejects(
    reconcileMcpConnectionMutation(
      { kind: 'cleanup', tenantId: 'mcp-tenant', id: view.id },
      view,
      'cleanup-once',
    ),
    (error: unknown) => error instanceof McpCredentialCleanupUncertainError,
    'Dismiss cannot replay the cleanup POST',
  )
  assert.equal(calls.length, 2)
  assert.ok(calls.every((call) => call.startsWith('GET ')))
})

test('MCP detail reads have an authoritative bounded request path', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch; refreshAccount(null) })
  refreshAccount({ userId: 'mcp-user', tenantId: 'mcp-tenant' })
  let signal: AbortSignal | undefined
  globalThis.fetch = async (_input, init) => {
    signal = init?.signal
    return jsonResponse(view)
  }
  assert.deepEqual(await getMcpConnection(view.id), view)
  assert.ok(signal, 'detail reads pass an abort deadline to fetch')
})

test('MCP detail reads reject an acknowledgement addressed to another connection', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch; refreshAccount(null) })
  refreshAccount({ userId: 'mcp-user', tenantId: 'mcp-tenant' })
  globalThis.fetch = async () => jsonResponse({ ...view, id: 'mcp-connection-other' })
  await assert.rejects(
    getMcpConnection(view.id),
    /addressed a different connection/,
  )
})

test('one newest-known view fences a detail-before-list response and a stale detail with no list query', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch; refreshAccount(null) })
  refreshAccount({ userId: 'mcp-user', tenantId: 'mcp-tenant' })
  const id = 'mcp-connection-' + 'b'.repeat(32)
  const newer: McpConnectionView = { ...view, id, revision: 7, tools: [{ name: 'newer', inputSchema: { type: 'object' } }] }
  const older: McpConnectionView = { ...view, id, revision: 3, tools: [{ name: 'older', inputSchema: { type: 'object' } }] }
  setData(keys.mcpConnections, { connections: [], capabilities: list().capabilities })
  setData(keys.mcpConnection(id), newer)
  globalThis.fetch = async () => jsonResponse({ connections: [older], capabilities: list().capabilities })
  assert.equal((await listMcpConnections()).connections[0]?.revision, 7,
    'an older full-list response cannot replace a newer detail read')

  // Remove the list projection to exercise the no-list path. The accepted
  // detail remains in the newest-known map while an older detail crosses it.
  setData(keys.mcpConnections, { connections: [], capabilities: list().capabilities })
  globalThis.fetch = async () => jsonResponse(older)
  assert.equal((await getMcpConnection(id)).revision, 7,
    'an older detail response cannot replace a newer acknowledged/detail view')
})

test('late detail reads cannot rewind a newer catalog or resurrect a tombstoned row', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch; refreshAccount(null) })
  refreshAccount({ userId: 'mcp-user', tenantId: 'mcp-tenant' })
  const newer = { ...view, revision: 4, tools: [{ name: 'newer', inputSchema: { type: 'object' } }] }
  const older = { ...view, revision: 2, tools: [{ name: 'older', inputSchema: { type: 'object' } }] }
  setData(keys.mcpConnection(view.id), newer)
  setData(keys.mcpConnections, { connections: [newer], capabilities: list().capabilities })
  globalThis.fetch = async () => jsonResponse(older)
  assert.equal((await getMcpConnection(view.id)).revision, 4)
  assert.equal((await getMcpConnection(view.id)).tools[0]?.name, 'newer')
  globalThis.fetch = async () => jsonResponse({ connections: [older], capabilities: list().capabilities })
  assert.equal((await listMcpConnections()).connections[0]?.revision, 4)

  setData(keys.mcpConnection(view.id), newer)
  globalThis.fetch = async () => jsonResponse({ connection: older, credentialCleanup: 'complete' })
  await applyMcpConnectionMutation(
    { kind: 'disconnect', tenantId: 'mcp-tenant', id: view.id, expectedRevision: 4 },
    'disconnect-stale-ack',
  )
  assert.equal(peek<McpConnectionView>(keys.mcpConnection(view.id))?.revision, 4, 'a stale acknowledgement cannot rewind a newer detail')

  setData(keys.mcpConnection(view.id), newer)
  globalThis.fetch = async (_input, init) => init?.method === 'DELETE'
    ? jsonResponse({ removed: true, credentialCleanup: 'complete' })
    : jsonResponse(newer)
  await applyMcpConnectionMutation(
    { kind: 'remove', tenantId: 'mcp-tenant', id: view.id, expectedRevision: 4 },
    'remove-tombstone',
  )
  await assert.rejects(getMcpConnection(view.id), /older than the current local state/)
  globalThis.fetch = async () => jsonResponse({ connections: [newer], capabilities: list().capabilities })
  assert.deepEqual((await listMcpConnections()).connections, [], 'a stale full list cannot resurrect a removed row')

  // Tombstones are account-local. A fresh account may legitimately address a
  // reused fixture id without inheriting the previous tenant's deletion fence.
  refreshAccount({ userId: 'mcp-user-2', tenantId: 'mcp-tenant-2' })
  globalThis.fetch = async () => new Response(JSON.stringify({ connections: [older], capabilities: list().capabilities }), {
    headers: { 'Content-Type': 'application/json', 'x-resolved-tenant': 'mcp-tenant-2' },
  })
  assert.equal((await listMcpConnections()).connections[0]?.revision, 2)
})
