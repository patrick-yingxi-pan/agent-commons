import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import {
  MCP_OAUTH_CREDENTIAL_CANCEL,
  MCP_OAUTH_CREDENTIAL_RESOLVE,
  MCP_OAUTH_CREDENTIAL_RESULT,
  createMcpOAuthCredentialHost,
  installMcpOAuthCredentialRuntime,
} from './mcpOAuthCredentialProtocol.mjs'

class FakePort extends EventEmitter {
  sent: unknown[] = []
  postMessage(message: unknown) { this.sent.push(message) }
}
class PairPort extends EventEmitter {
  peer?: PairPort
  sent: unknown[] = []
  postMessage(message: unknown) {
    this.sent.push(message)
    queueMicrotask(() => this.peer?.emit('message', message))
  }
}

const reference = `MCP_DESKTOP_${'A'.repeat(32)}`
const binding = Object.freeze({ tenantId: 'tenant-shared', connectionId: 'mcp-connection-owner',
  endpoint: 'https://mcp.example.test/rpc', ownerUserId: 'user-owner', connectionRevision: 4 })
const turn = () => new Promise<void>(resolve => setImmediate(resolve))

function connected() {
  const childPort = new PairPort()
  const hostPort = new PairPort()
  childPort.peer = hostPort
  hostPort.peer = childPort
  return { childPort, hostPort }
}

test('OAuth resolve uses its separate channel and returns only a secret after exact binding/current checks', async () => {
  const { childPort, hostPort } = connected()
  const seen: unknown[] = []
  const runtime = installMcpOAuthCredentialRuntime(childPort as any, { timeoutMs: 100 })
  const host = createMcpOAuthCredentialHost(hostPort as any, {
    resolve: async (candidate, supplied, options) => {
      seen.push([candidate, supplied, Object.keys(options).sort(), options.isCurrent(), options.signal.aborted])
      return 'ephemeral-access-token'
    }, timeoutMs: 100,
  })
  try {
    const result = await runtime.resolve(reference, binding, { isCurrent: () => true })
    assert.equal(result, 'ephemeral-access-token')
    assert.deepEqual(seen, [[reference, binding, ['isCurrent', 'signal'], true, false]])
    assert.equal(childPort.sent[0] && (childPort.sent[0] as any).type, MCP_OAUTH_CREDENTIAL_RESOLVE)
    assert.notEqual((childPort.sent[0] as any).type, 'agent-commons:mcp-credential:resolve')
    assert.equal(JSON.stringify(childPort.sent).includes('ownerUserId'), true)
    assert.equal(JSON.stringify(childPort.sent).includes('ephemeral-access-token'), false)
  } finally { runtime.close(); host.close() }
})

test('runtime rejects malformed, private, accessor-backed, detached or stale requests before send', async () => {
  const port = new FakePort()
  const runtime = installMcpOAuthCredentialRuntime(port as any, { timeoutMs: 15 })
  let getterCalls = 0
  const accessor = { ...binding }
  Object.defineProperty(accessor, 'ownerUserId', { enumerable: true, get() { getterCalls++; return binding.ownerUserId } })
  const invalid = [
    [`MCP_DESKTOP_${'b'.repeat(32)}`, binding],
    [reference, { ...binding, extra: true }],
    [reference, { ...binding, endpoint: 'http://mcp.example.test/rpc' }],
    [reference, { ...binding, endpoint: 'https://127.0.0.1/rpc' }],
    [reference, { ...binding, ownerUserId: '   ' }],
    [reference, accessor],
  ]
  for (const [candidate, target] of invalid) {
    await assert.rejects(runtime.resolve(candidate as string, target as any, { isCurrent: () => true }), /invalid or stale/)
  }
  await assert.rejects(runtime.resolve(reference, binding, { isCurrent: () => false }), /invalid or stale/)
  await assert.rejects(runtime.resolve(reference, binding, { isCurrent: async () => true }), /invalid or stale/)
  assert.equal(getterCalls, 0, 'accessor input is refused without invoking it')
  assert.deepEqual(port.sent, [])
  runtime.close()
})

test('host rejects malformed envelopes/bindings without calling resolver and never reflects errors', async () => {
  const child = new FakePort()
  let reads = 0
  const host = createMcpOAuthCredentialHost(child as any, { resolve: async () => { reads++; throw new Error('secret-token=private') } })
  child.emit('message', { type: MCP_OAUTH_CREDENTIAL_RESOLVE, requestId: 1, reference, binding: { ...binding, ownerUserId: '' } })
  child.emit('message', { type: MCP_OAUTH_CREDENTIAL_RESOLVE, requestId: 2, reference, binding, extra: 'reject' })
  await turn()
  assert.equal(reads, 0)
  assert.deepEqual(child.sent, [
    { type: MCP_OAUTH_CREDENTIAL_RESULT, requestId: 1, ok: false, error: 'unavailable' },
    { type: MCP_OAUTH_CREDENTIAL_RESULT, requestId: 2, ok: false, error: 'unavailable' },
  ])
  assert.equal(JSON.stringify(child.sent).includes('secret-token'), false)
  host.close()
})

test('host rejects a settled request id replay without repeating credential resolution', async () => {
  const child = new FakePort()
  let resolveCount = 0
  const host = createMcpOAuthCredentialHost(child as any, { resolve: async () => {
    resolveCount++
    return 'one-use-access-token'
  } })
  const request = { type: MCP_OAUTH_CREDENTIAL_RESOLVE, requestId: 7, reference, binding }
  child.emit('message', request)
  await turn()
  assert.equal(resolveCount, 1)
  assert.deepEqual(child.sent, [{ type: MCP_OAUTH_CREDENTIAL_RESULT, requestId: 7, ok: true, secret: 'one-use-access-token' }])

  child.emit('message', request)
  await turn()
  assert.equal(resolveCount, 1, 'an exact retry after settlement never repeats vault/refresh work')
  assert.deepEqual(child.sent.at(-1), { type: MCP_OAUTH_CREDENTIAL_RESULT, requestId: 7, ok: false, error: 'unavailable' })
  host.close()
})

test('child rechecks freshness on reply and sends explicit cancel when source becomes stale', async () => {
  const port = new FakePort()
  const runtime = installMcpOAuthCredentialRuntime(port as any, { timeoutMs: 100 })
  let live = true
  const result = runtime.resolve(reference, binding, { isCurrent: () => live })
  const request = port.sent.at(-1) as any
  live = false
  port.emit('message', { type: MCP_OAUTH_CREDENTIAL_RESULT, requestId: request.requestId, ok: true, secret: 'token-value' })
  await assert.rejects(result, /unavailable/)
  const abort = new AbortController()
  const cancelled = runtime.resolve(reference, binding, { isCurrent: () => true, signal: abort.signal })
  const cancelRequest = port.sent.at(-1) as any
  abort.abort()
  await assert.rejects(cancelled, /cancelled/)
  assert.deepEqual(port.sent.at(-1), { type: MCP_OAUTH_CREDENTIAL_CANCEL, requestId: cancelRequest.requestId })
  runtime.close()
})

test('host cancellation aborts resolver, answers promptly, retains its slot, and suppresses late completion', async () => {
  const child = new FakePort()
  let release!: (value: string) => void
  let started!: () => void
  const startedPromise = new Promise<void>(resolve => { started = resolve })
  let resolverSignal: AbortSignal | undefined
  let current: (() => boolean) | undefined
  let resolveCount = 0
  const host = createMcpOAuthCredentialHost(child as any, { maxPending: 1, timeoutMs: 200,
    resolve: (_ref, _binding, options) => {
      resolveCount++
      if (resolveCount > 1) return Promise.resolve('fresh-secret')
      resolverSignal = options.signal
      current = options.isCurrent
      started()
      return new Promise(resolve => { release = resolve })
    } })
  child.emit('message', { type: MCP_OAUTH_CREDENTIAL_RESOLVE, requestId: 1, reference, binding })
  await startedPromise
  child.emit('message', { type: MCP_OAUTH_CREDENTIAL_CANCEL, requestId: 1 })
  assert.equal(resolverSignal?.aborted, true)
  assert.equal(current?.(), false)
  assert.deepEqual(child.sent, [{ type: MCP_OAUTH_CREDENTIAL_RESULT, requestId: 1, ok: false, error: 'unavailable' }])
  child.emit('message', { type: MCP_OAUTH_CREDENTIAL_RESOLVE, requestId: 2, reference, binding })
  assert.deepEqual(child.sent.at(-1), { type: MCP_OAUTH_CREDENTIAL_RESULT, requestId: 2, ok: false, error: 'unavailable' },
    'cancelled underlying work still occupies bounded capacity')
  release('late-secret')
  await turn()
  assert.equal(child.sent.length, 2, 'late completion is suppressed')
  child.emit('message', { type: MCP_OAUTH_CREDENTIAL_RESOLVE, requestId: 3, reference, binding })
  await turn()
  assert.deepEqual(child.sent.at(-1), { type: MCP_OAUTH_CREDENTIAL_RESULT, requestId: 3, ok: true, secret: 'fresh-secret' },
    'capacity returns after underlying settlement')
  host.close()
})

test('runtime timeout sends cancellation and ignores late result; channel close rejects pending calls', async () => {
  const port = new FakePort()
  const runtime = installMcpOAuthCredentialRuntime(port as any, { timeoutMs: 15 })
  const pending = runtime.resolve(reference, binding, { isCurrent: () => true })
  const request = port.sent.at(-1) as any
  await assert.rejects(pending, /timed out/)
  assert.deepEqual(port.sent.at(-1), { type: MCP_OAUTH_CREDENTIAL_CANCEL, requestId: request.requestId })
  port.emit('message', { type: MCP_OAUTH_CREDENTIAL_RESULT, requestId: request.requestId, ok: true, secret: 'late' })
  const next = runtime.resolve(reference, binding, { isCurrent: () => true })
  runtime.close()
  await assert.rejects(next, /channel is unavailable/)
})

test('host deadline retains the slot until an abort-ignoring resolver settles', async () => {
  const child = new FakePort()
  let release!: (value: string) => void
  const host = createMcpOAuthCredentialHost(child as any, { maxPending: 1, timeoutMs: 15,
    resolve: () => new Promise(resolve => { release = resolve }) })
  child.emit('message', { type: MCP_OAUTH_CREDENTIAL_RESOLVE, requestId: 1, reference, binding })
  await turn()
  await new Promise(resolve => setTimeout(resolve, 25))
  assert.deepEqual(child.sent, [{ type: MCP_OAUTH_CREDENTIAL_RESULT, requestId: 1, ok: false, error: 'unavailable' }])
  child.emit('message', { type: MCP_OAUTH_CREDENTIAL_RESOLVE, requestId: 2, reference, binding })
  assert.deepEqual(child.sent.at(-1), { type: MCP_OAUTH_CREDENTIAL_RESULT, requestId: 2, ok: false, error: 'unavailable' })
  release('late-secret')
  await turn()
  host.close()
})

test('host close aborts active resolver and suppresses any later result', async () => {
  const child = new FakePort()
  let release!: (value: string) => void
  let signal: AbortSignal | undefined
  let isCurrent: (() => boolean) | undefined
  const host = createMcpOAuthCredentialHost(child as any, { resolve: (_ref, _binding, options) => {
    signal = options.signal
    isCurrent = options.isCurrent
    return new Promise(resolve => { release = resolve })
  } })
  child.emit('message', { type: MCP_OAUTH_CREDENTIAL_RESOLVE, requestId: 1, reference, binding })
  await turn()
  host.close()
  assert.equal(signal?.aborted, true)
  assert.equal(isCurrent?.(), false)
  release('late-secret')
  await turn()
  assert.deepEqual(child.sent, [])
})
