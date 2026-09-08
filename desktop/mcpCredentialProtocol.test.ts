import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import {
  MCP_CREDENTIAL_BINDINGS,
  MCP_CREDENTIAL_RESOLVE,
  MCP_CREDENTIAL_RESULT,
  createMcpCredentialHost,
  installMcpCredentialRuntime,
} from './mcpCredentialProtocol.mjs'

class FakePort extends EventEmitter {
  sent: unknown[] = []
  postMessage(message: unknown) { this.sent.push(message) }
}

const reference = `MCP_DESKTOP_${'A'.repeat(32)}`
const binding = { tenantId: 'tenant-a', connectionId: 'mcp-1', endpoint: 'https://mcp.example.test/tools' }

test('MCP runtime resolves a secret on demand without mutating environment', async () => {
  const port = new FakePort()
  const runtime = installMcpCredentialRuntime(port as any, { timeoutMs: 50 })
  const pending = runtime.resolve(reference, binding)
  const request = port.sent.at(-1) as any
  assert.equal(request.type, MCP_CREDENTIAL_RESOLVE)
  assert.deepEqual(request.binding, binding)
  assert.equal(Object.keys(process.env).some((key) => key.startsWith('MCP_DESKTOP_')), false)
  port.emit('message', { data: { type: MCP_CREDENTIAL_RESULT, requestId: request.requestId, ok: true, secret: 'bearer-token' } })
  assert.equal(await pending, 'bearer-token')
  runtime.close()
})

test('host validates binding before vault read and correlates generic failures', async () => {
  const child = new FakePort()
  const reads: unknown[] = []
  const host = createMcpCredentialHost(child as any, {
    resolve: async (candidate, supplied) => { reads.push([candidate, supplied]); return 'secret-value' },
  })
  child.emit('message', { type: MCP_CREDENTIAL_RESOLVE, requestId: 1, reference, binding })
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.deepEqual(reads, [['MCP_DESKTOP_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', binding]])
  assert.deepEqual(child.sent.at(-1), { type: MCP_CREDENTIAL_RESULT, requestId: 1, ok: true, secret: 'secret-value' })
  child.emit('message', { type: MCP_CREDENTIAL_RESOLVE, requestId: 2, reference, binding: { ...binding, endpoint: 'https://user:pass@mcp.example.test/tools' } })
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(reads.length, 1)
  assert.deepEqual(child.sent.at(-1), { type: MCP_CREDENTIAL_RESULT, requestId: 2, ok: false, error: 'unavailable' })
  child.emit('message', { type: MCP_CREDENTIAL_RESOLVE, requestId: 3, reference, binding: { ...binding, extra: 'nope' } })
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(reads.length, 1)
  child.emit('message', { type: MCP_CREDENTIAL_RESOLVE, requestId: 4, reference, binding: { ...binding, endpoint: 'https://mcp.example.test/tools#' } })
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(reads.length, 1)
  host.close()
})

test('binding announcements are bounded, authoritative metadata and never contain secrets', () => {
  const child = new FakePort()
  const seen: unknown[] = []
  const host = createMcpCredentialHost(child as any, { resolve: async () => 'unused', onBindings: (value) => seen.push(value) })
  child.emit('message', { type: MCP_CREDENTIAL_BINDINGS, bindings: [{ reference, binding }] })
  assert.deepEqual(seen, [[{ reference, binding }]])
  assert.equal(JSON.stringify(child.sent).includes('secret'), false)
  child.sent.length = 0
  child.emit('message', { type: MCP_CREDENTIAL_BINDINGS, bindings: [
    { reference, binding },
    { reference: `MCP_DESKTOP_${'B'.repeat(32)}`, binding },
  ] })
  assert.equal(seen.length, 1, 'a second live reference for one binding is rejected')

  const port = new FakePort()
  const runtime = installMcpCredentialRuntime(port as any)
  runtime.announceBindings([{ reference, binding }, { reference: 'bad', binding }])
  assert.equal(port.sent.length, 0)
  runtime.close()
  host.close()
})

test('runtime enforces timeout, capacity, close, and ignores late or malformed replies', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const port = new FakePort()
  const runtime = installMcpCredentialRuntime(port as any, { timeoutMs: 10, maxPending: 1 })
  t.after(() => runtime.close())
  const first = runtime.resolve(reference, binding)
  await assert.rejects(runtime.resolve(`MCP_DESKTOP_${'C'.repeat(32)}`, binding), /busy/)
  const request = port.sent.at(-1) as any
  port.emit('message', { type: MCP_CREDENTIAL_RESULT, requestId: request.requestId, ok: true, secret: 'bad\nsecret' })
  await assert.rejects(first, /unavailable|timed out/)
  const timedOut = runtime.resolve(reference, binding)
  const timeoutRejection = assert.rejects(timedOut, /timed out/)
  t.mock.timers.tick(10)
  await timeoutRejection
  const second = runtime.resolve(reference, binding)
  runtime.close()
  await assert.rejects(second, /unavailable/)
  port.emit('message', { type: MCP_CREDENTIAL_RESULT, requestId: 999, ok: true, secret: 'late-secret' })
})

test('host close detaches and suppresses a late vault response', async () => {
  const child = new FakePort()
  let release!: (secret: string) => void
  const host = createMcpCredentialHost(child as any, { resolve: () => new Promise((resolve) => { release = resolve }) })
  child.emit('message', { type: MCP_CREDENTIAL_RESOLVE, requestId: 7, reference, binding })
  await new Promise<void>((resolve) => setImmediate(resolve))
  host.close()
  release('late-secret')
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.deepEqual(child.sent, [])
})

test('synchronous child-send failure frees the runtime slot with a generic rejection', async () => {
  const port = new FakePort()
  port.postMessage = () => { throw new Error('child exited with secret=not-for-output') }
  const runtime = installMcpCredentialRuntime(port as any, { maxPending: 1 })
  await assert.rejects(runtime.resolve(reference, binding), /channel is unavailable/)
  await assert.rejects(runtime.resolve(reference, binding), /channel is unavailable/, 'a failed send does not strand the pending slot')
  runtime.close()
})

test('host deadline releases a hung vault slot and absorbs async callback failure', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const child = new FakePort()
  let reads = 0
  const host = createMcpCredentialHost(child as any, {
    timeoutMs: 10,
    maxPending: 1,
    resolve: () => {
      reads += 1
      return reads === 1 ? new Promise(() => {}) : Promise.resolve('fresh-secret')
    },
    onBindings: async () => { throw new Error('callback detail=secret') },
  })
  t.after(() => host.close())
  child.emit('message', { type: MCP_CREDENTIAL_BINDINGS, bindings: [{ reference, binding }] })
  child.emit('message', { type: MCP_CREDENTIAL_RESOLVE, requestId: 1, reference, binding })
  await new Promise<void>((resolve) => setImmediate(resolve))
  t.mock.timers.tick(10)
  assert.deepEqual(child.sent.at(-1), { type: MCP_CREDENTIAL_RESULT, requestId: 1, ok: false, error: 'unavailable' })
  child.emit('message', { type: MCP_CREDENTIAL_RESOLVE, requestId: 2, reference, binding })
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.deepEqual(child.sent.at(-1), { type: MCP_CREDENTIAL_RESULT, requestId: 2, ok: true, secret: 'fresh-secret' })
  host.close()
})

test('host ignores a timed-out completion after request-id reuse', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const child = new FakePort()
  const firstBinding = binding
  const secondBinding = { ...binding, connectionId: 'mcp-2' }
  const firstReference = reference
  const secondReference = `MCP_DESKTOP_${'B'.repeat(32)}`
  const releases = new Map<string, (secret: string) => void>()
  const host = createMcpCredentialHost(child as any, {
    timeoutMs: 10,
    resolve: (_candidateReference, candidateBinding) => new Promise((resolve) => {
      releases.set(candidateBinding.connectionId, resolve)
    }),
  })
  t.after(() => host.close())

  child.emit('message', { type: MCP_CREDENTIAL_RESOLVE, requestId: 7, reference: firstReference, binding: firstBinding })
  await new Promise<void>((resolve) => setImmediate(resolve))
  t.mock.timers.tick(9)
  assert.deepEqual(child.sent, [], 'a live request retains its slot until the deadline')
  t.mock.timers.tick(1)
  assert.deepEqual(child.sent, [{ type: MCP_CREDENTIAL_RESULT, requestId: 7, ok: false, error: 'unavailable' }])

  child.emit('message', { type: MCP_CREDENTIAL_RESOLVE, requestId: 7, reference: secondReference, binding: secondBinding })
  await new Promise<void>((resolve) => setImmediate(resolve))
  releases.get('mcp-1')?.('old-secret')
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(child.sent.length, 1, 'the late first completion must not answer the reused request id')

  releases.get('mcp-2')?.('new-secret')
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.deepEqual(child.sent.at(-1), { type: MCP_CREDENTIAL_RESULT, requestId: 7, ok: true, secret: 'new-secret' })
  assert.equal(child.sent.length, 2)
  host.close()
})
