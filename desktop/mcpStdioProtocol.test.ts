import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createMcpStdioClient } from '../server/mcpStdioClient.ts'
import { createMcpStdioHost, installMcpStdioRuntime, MCP_STDIO_PROTOCOL } from './mcpStdioProtocol.mjs'
import { createMcpStdioSupervisor } from './mcpStdioSupervisor.mjs'

const reference = `MCP_STDIO_${'A'.repeat(32)}`
const binding = Object.freeze({ tenantId: 'tenant-fixture', ownerUserId: 'user-fixture',
  connectionId: `mcp-connection-${'a'.repeat(32)}`, connectionRevision: 4 })
const tick = () => new Promise<void>(resolve => setImmediate(resolve))
async function waitFor<T>(read: () => T | undefined, timeoutMs = 500) {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    const value = read()
    if (value !== undefined) return value
    await new Promise(resolve => setTimeout(resolve, 2))
  }
  throw new Error('Timed out waiting for fixture protocol message.')
}
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

class PairPort extends EventEmitter {
  peer?: PairPort
  sent: unknown[] = []
  postMessage(message: unknown) {
    this.sent.push(message)
    queueMicrotask(() => this.peer?.emit('message', message))
  }
}
function pair() {
  const utility = new PairPort(), native = new PairPort()
  utility.peer = native
  native.peer = utility
  return { utility, native }
}
function connection(result = { ok: true }) {
  let resolveClosed!: (value?: unknown) => void
  const closed = new Promise(resolve => { resolveClosed = resolve })
  const calls: Array<[string, Record<string, unknown> | undefined, { signal: AbortSignal; beforeDispatch?: () => boolean }?]> = []
  let closeCalls = 0
  const value = {
    request: async (method: string, params?: Record<string, unknown>, options?: { signal: AbortSignal; beforeDispatch?: () => boolean }) => {
      calls.push([method, params, options])
      if (method === 'tools/call') assert.equal(options?.beforeDispatch?.(), true)
      return result
    },
    initialized: async () => { calls.push(['initialized', undefined]) },
    close: () => { closeCalls += 1 },
    closed,
    finish: () => resolveClosed({ code: 'closed' }),
    get closeCalls() { return closeCalls },
  }
  return { value, calls }
}

test('stdio bridge carries modern client discovery and calls through an owned native supervisor child', { skip: process.platform !== 'darwin' }, async t => {
  const { utility, native } = pair()
  const supervisor = createMcpStdioSupervisor({ targetPlatform: 'darwin' })
  let physicalCloses = 0
  const fixtureDir = await mkdtemp(join(tmpdir(), 'ac-stdio-protocol-'))
  const tracePath = join(fixtureDir, 'trace.jsonl')
  const peerPath = join(ROOT, 'desktop', 'mcpStdioSmokePeer.mjs')
  const launch = { executable: process.execPath, args: [peerPath, tracePath], cwd: process.cwd(), env: { AC_MCP_STDIO_FIXTURE_TRACE: tracePath } }
  const host = createMcpStdioHost(native as any, {
    isCurrent: (_reference: string, _binding: unknown, _purpose: string) => true,
    synchronize: async entries => ({ available: entries.every(entry => entry.reference === null || entry.reference === reference) }),
    open: (candidate, supplied, options) => {
      assert.equal(candidate, reference)
      assert.deepEqual(supplied, binding)
      const connection = supervisor.open(launch, { signal: options.signal, isCurrent: options.isCurrent })
      void connection.closed.then(() => { physicalCloses++ })
      return connection
    },
  })
  const runtime = installMcpStdioRuntime(utility)
  t.after(async () => { await runtime?.close(); await host.close(); supervisor.dispose(); await rm(fixtureDir, { recursive: true, force: true }) })
  const live = () => true
  const inspectClient = createMcpStdioClient({ open: options => runtime!.open(reference, binding, { ...options, purpose: 'inspect' }) })
  const discovered = await inspectClient.discover({ isCurrent: live })
  assert.equal(discovered.protocolVersion, '2026-07-28')
  assert.deepEqual(discovered.tools.map(tool => tool.name), ['records.search'])

  const callClient = createMcpStdioClient({ open: options => runtime!.open(reference, binding, { ...options, purpose: 'call' }) })
  const result = await callClient.callTool({ tool: { name: 'records.search', inputSchema: {
    type: 'object', properties: { query: { type: 'string', minLength: 1, maxLength: 128 } }, required: ['query'], additionalProperties: false,
  } }, arguments: { query: 'fixture-result' } },
    { isCurrent: live, beforeCall: live })
  assert.equal(result.result.content[0].text, 'Local fixture result for: fixture-result')
  assert.equal(physicalCloses, 2, 'client cleanup awaited physical close for both owned processes')
  const trace = (await readFile(tracePath, 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line))
  assert.equal(trace.filter(row => row.kind === 'request' && row.method === 'tools/call').length, 1)
  assert.deepEqual(trace.filter(row => row.kind === 'process-start').map(row => row.environmentKeys),
    [['AC_MCP_STDIO_FIXTURE_TRACE', '__CF_USER_TEXT_ENCODING'], ['AC_MCP_STDIO_FIXTURE_TRACE', '__CF_USER_TEXT_ENCODING']])
  assert.equal(JSON.stringify(utility.sent).includes('executable'), false, 'utility protocol never receives launch configuration')
  assert.equal(JSON.stringify(utility.sent).includes('ownerUserId'), true, 'the fixed private binding is explicit')
})

test('stdio bridge completes legacy discovery and one approved call after fresh initialization', { skip: process.platform !== 'darwin' }, async t => {
  const { utility, native } = pair()
  const supervisor = createMcpStdioSupervisor()
  // Authored peer only: no package, network, credentials or user files.
  const peer = `
    import readline from 'node:readline';
    const input = readline.createInterface({ input: process.stdin });
    const methods = [];
    let initialized = false;
    input.on('line', line => {
      const row = JSON.parse(line); methods.push(row.method);
      const send = value => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: row.id, ...value }) + '\\n');
      if (row.method === 'server/discover') return send({ error: { code: -32601, message: 'Method not found' } });
      if (row.method === 'initialize') return send({ result: { protocolVersion: '2025-11-25',
        capabilities: { tools: {} }, serverInfo: { name: 'owned legacy bridge peer', version: '1' } } });
      if (row.method === 'notifications/initialized' && row.id === undefined) { initialized = true; return; }
      if (!initialized) return send({ error: { code: -32000, message: 'Not initialized' } });
      if (row.method === 'tools/list') return send({ result: { tools: [{ name: 'echo',
        inputSchema: { type: 'object' }, annotations: { methods } }] } });
      if (row.method === 'tools/call') return send({ result: { content: [{ type: 'text', text: 'literal legacy result' }],
        structuredContent: { methods } } });
    });
  `
  let opens = 0, physicalCloses = 0
  const host = createMcpStdioHost(native, {
    isCurrent: () => true, synchronize: async () => ({ available: true }),
    open: (_reference, _binding, options) => {
      assert.equal(physicalCloses, opens, 'legacy fallback waits for physical probe closure')
      opens += 1
      const connection = supervisor.open({ executable: process.execPath,
        args: ['--input-type=module', '-e', peer], cwd: tmpdir(), env: {} }, options)
      void connection.closed.then(() => { physicalCloses += 1 })
      return connection
    },
  })
  const runtime = installMcpStdioRuntime(utility)!
  t.after(async () => { await runtime.close(); await host.close(); await supervisor.dispose() })
  const client = (purpose: 'inspect' | 'call') => createMcpStdioClient({
    open: options => runtime.open(reference, binding, { ...options, purpose }),
  })
  const catalog = await client('inspect').discover({ isCurrent: () => true })
  assert.equal(catalog.protocolVersion, '2025-11-25')
  assert.equal(catalog.cleanup, 'released')
  assert.deepEqual(catalog.tools[0].annotations?.methods, ['initialize', 'notifications/initialized', 'tools/list'])
  assert.equal(physicalCloses, 2)
  const call = await client('call').callTool({ tool: catalog.tools[0], arguments: {} },
    { isCurrent: () => true, beforeCall: () => true, expectedProtocolVersion: '2025-11-25' })
  assert.equal(call.cleanup, 'released')
  assert.deepEqual(call.result.content, [{ type: 'text', text: 'literal legacy result' }])
  assert.deepEqual(call.result.structuredContent, { methods: ['initialize', 'notifications/initialized', 'tools/call'] })
  assert.equal(opens, 4)
  assert.equal(physicalCloses, 4)
  const calls = utility.sent.filter((row: any) => row.type === MCP_STDIO_PROTOCOL.rpc) as any[]
  assert.deepEqual(calls.map(row => row.method), [
    'server/discover', 'initialize', 'initialized', 'tools/list',
    'server/discover', 'initialize', 'initialized', 'tools/call',
  ])
  for (const notification of calls.filter(row => row.method === 'initialized')) {
    assert.deepEqual(Object.keys(notification).sort(), ['method', 'requestId', 'sessionId', 'type'])
  }
})

test('initialized is notification-only and does not widen the stdio request allowlist', async t => {
  const { utility, native } = pair(), conn = connection()
  const host = createMcpStdioHost(native, { open: async () => conn.value,
    synchronize: async () => ({ available: true }), isCurrent: () => true })
  const runtime = installMcpStdioRuntime(utility)!
  t.after(async () => { conn.value.finish(); await runtime.close(); await host.close() })
  const stream = runtime.open(reference, binding, { isCurrent: () => true, purpose: 'inspect' })
  for (const method of ['initialized', 'notifications/initialized', 'notifications/cancelled', 'unknown']) {
    await assert.rejects(stream.request(method, {}), error => error.code === 'invalid')
  }
  await assert.rejects(stream.request('tools/call', { name: 'echo', arguments: {} }, { beforeDispatch: () => true }),
    error => error.code === 'invalid')
  assert.deepEqual(conn.calls, [])
  assert.equal(utility.sent.some((row: any) => row.type === MCP_STDIO_PROTOCOL.rpc), false)
  await stream.initialized()
  assert.deepEqual(conn.calls, [['initialized', undefined]])
})

test('inspection purpose cannot dispatch, request IDs cannot replay, and final dispatch checks current authority', async t => {
  const { utility, native } = pair(), conn = connection()
  let current = true
  const host = createMcpStdioHost(native as any, { open: async () => conn.value,
    synchronize: async () => ({ available: true }), isCurrent: () => current })
  const runtime = installMcpStdioRuntime(utility)
  t.after(async () => { conn.value.finish(); await runtime?.close().catch(() => {}); await host.close() })
  const inspected = runtime!.open(reference, binding, { isCurrent: () => current, purpose: 'inspect' })
  await assert.rejects(inspected.request('tools/call', { name: 'nope', arguments: {} }, { beforeDispatch: () => true }), /failed/)
  assert.deepEqual(conn.calls, [])
  await inspected.request('tools/list', {})
  assert.equal(conn.calls.length, 1)
  const firstRequest = utility.sent.find((row: any) => row.type === MCP_STDIO_PROTOCOL.rpc) as any
  utility.postMessage({ type: MCP_STDIO_PROTOCOL.rpc, requestId: firstRequest.requestId, sessionId: firstRequest.sessionId,
    method: 'tools/list', params: {} })
  await tick()
  assert.equal(conn.calls.length, 1, 'a replayed sequence number never reaches the connection')
  const inspectedClosing = inspected.close()
  conn.value.finish()
  await inspectedClosing
  await inspected.closed

  const callable = runtime!.open(reference, binding, { isCurrent: () => current, purpose: 'call' })
  const before = conn.calls.length
  current = false
  await assert.rejects(callable.request('tools/call', { name: 'x', arguments: {} }, { beforeDispatch: () => true }), /failed/)
  assert.equal(conn.calls.length, before, 'revoked native identity blocks the connection call')
  current = true
  const callableClosing = callable.close()
  conn.value.finish()
  await callableClosing
  await callable.closed
})

test('authority revoked at the native write edge is refused without claiming request submission', async t => {
  const { utility, native } = pair()
  let current = true, finalGuard: boolean | undefined
  let resolveClosed!: () => void
  const closed = new Promise<void>(resolve => { resolveClosed = resolve })
  const fake = {
    request: async (_method: string, _params: unknown, options: { beforeDispatch?: () => boolean }) => {
      current = false
      finalGuard = options.beforeDispatch?.()
      if (!finalGuard) throw Object.assign(new Error('untrusted diagnostics'), { code: 'stale', mayHaveSubmitted: false })
      return { resultType: 'complete', isError: false, content: [] }
    },
    initialized: async () => {}, close: () => {}, closed,
  }
  const host = createMcpStdioHost(native as any, { open: async () => fake,
    synchronize: async () => ({ available: true }), isCurrent: () => current })
  const runtime = installMcpStdioRuntime(utility)
  t.after(async () => { resolveClosed(); await runtime?.close().catch(() => {}); await host.close() })
  const session = runtime!.open(reference, binding, { isCurrent: () => current, purpose: 'call' })
  const pending = session.request('tools/call', { name: 'effect', arguments: {} }, { beforeDispatch: () => true })
  await assert.rejects(pending, error => {
    assert.equal((error as any).code, 'stale')
    assert.equal((error as any).mayHaveSubmitted, false)
    return true
  })
  assert.equal(finalGuard, false, 'native lifecycle authority is sampled at the connection write edge')
  const closing = session.close()
  resolveClosed()
  await closing
  await session.closed
})

test('an open cancelled in flight retains its session until the physical connection closes', async t => {
  const { utility, native } = pair(), conn = connection()
  let finishOpen!: (value: typeof conn.value) => void
  let started!: () => void
  const startedPromise = new Promise<void>(resolve => { started = resolve })
  const host = createMcpStdioHost(native as any, { open: () => { started(); return new Promise(resolve => { finishOpen = resolve }) },
    synchronize: async () => ({ available: true }), isCurrent: () => true })
  const runtime = installMcpStdioRuntime(utility)
  t.after(async () => { finishOpen?.(conn.value); conn.value.finish(); await runtime?.close().catch(() => {}); await host.close() })
  const abort = new AbortController()
  const opened = runtime!.open(reference, binding, { isCurrent: () => true, purpose: 'call', signal: abort.signal })
  const request = opened.request('tools/list', {})
  await startedPromise
  abort.abort()
  await assert.rejects(request, /failed/)
  await tick()
  assert.equal(host.activeSessions, 1, 'cancellation is not proof that the async opener released its slot')
  finishOpen(conn.value)
  for (let i = 0; i < 20 && conn.value.closeCalls === 0; i++) await tick()
  assert.equal(conn.value.closeCalls, 1)
  assert.equal(host.activeSessions, 1, 'close() alone is not physical-close acknowledgement')
  conn.value.finish()
  await opened.closed
  assert.equal(host.activeSessions, 0)
})

test('sync snapshots permit metadata-only null references and serialize slow callbacks', async t => {
  const { utility, native } = pair()
  const releases: Array<(value: { available: boolean }) => void> = []
  let calls = 0, signalStarted!: () => void
  const entered = new Promise<void>(resolve => { signalStarted = resolve })
  const host = createMcpStdioHost(native as any, { open: async () => connection().value,
    synchronize: entries => {
      calls++
      assert.deepEqual(entries, [{ reference: null, binding }])
      signalStarted()
      return new Promise(resolve => { releases.push(resolve) })
    }, isCurrent: () => true, syncTimeoutMs: 50 })
  const runtime = installMcpStdioRuntime(utility, { requestMs: 100 })
  t.after(async () => { releases.forEach(resolve => resolve({ available: true })); await runtime?.close(); await host.close() })
  const rows = [{ reference: null, binding: { ...binding } }]
  const first = runtime!.synchronize(rows)
  rows[0]!.binding.ownerUserId = 'mutated'
  await entered
  const second = runtime!.synchronize([{ reference: null, binding }])
  await new Promise(resolve => setTimeout(resolve, 70))
  assert.equal(calls, 1, 'a timeout response does not let a slow state write overtake the active sync')
  releases[0]!({ available: true })
  assert.deepEqual(await first, { available: false }, 'deadline is reported without pretending the callback settled')
  for (let i = 0; i < 20 && calls < 2; i++) await tick()
  assert.equal(calls, 2)
  releases[1]!({ available: true })
  assert.deepEqual(await second, { available: true })
  assert.equal(calls, 2)
})

test('a late physical close receipt frees the session after close timeout without revising the timeout result', async t => {
  const port = new EventEmitter() as EventEmitter & { sent: any[]; postMessage(value: any): void }
  port.sent = []
  port.postMessage = message => { port.sent.push(message) }
  const runtime = installMcpStdioRuntime(port as any, { openTimeoutMs: 20, requestMs: 100, maxSessions: 1 })
  const session = runtime!.open(reference, binding, { isCurrent: () => true, purpose: 'inspect' })
  const opened = waitFor(() => port.sent.find(message => message.type === MCP_STDIO_PROTOCOL.open))
  const openMessage = await opened
  port.emit('message', { type: MCP_STDIO_PROTOCOL.openResult, requestId: openMessage.requestId,
    sessionId: openMessage.sessionId, ok: true })
  const request = session.request('tools/list', {})
  const rpc = await waitFor(() => port.sent.find(message => message.type === MCP_STDIO_PROTOCOL.rpc))
  port.emit('message', { type: MCP_STDIO_PROTOCOL.rpcResult, requestId: rpc.requestId,
    sessionId: rpc.sessionId, ok: true, value: { tools: [] } })
  await request

  const closing = session.close()
  const closeMessage = await waitFor(() => port.sent.find(message => message.type === MCP_STDIO_PROTOCOL.close))
  await assert.rejects(closing, (error: any) => error?.code === 'timeout')
  let didClose = false
  void session.closed.then(() => { didClose = true })
  await tick()
  assert.equal(didClose, false, 'the deadline is not itself proof of physical close')
  port.emit('message', { type: MCP_STDIO_PROTOCOL.closeResult, requestId: closeMessage.requestId,
    sessionId: closeMessage.sessionId, ok: true })
  const closedByDeadline = await Promise.race([session.closed.then(() => true), new Promise<boolean>(resolve => setTimeout(() => resolve(false), 50))])
  assert.equal(closedByDeadline, true, 'a correlated late close receipt releases the session')
  assert.equal(didClose, true)
  await assert.rejects(closing, (error: any) => error?.code === 'timeout', 'late proof does not change the already-settled close promise')
  const reopened = runtime!.open(reference, binding, { isCurrent: () => true, purpose: 'inspect' })
  const reopenedClose = reopened.close()
  const reopenedMessage = await waitFor(() => port.sent.filter(message => message.type === MCP_STDIO_PROTOCOL.close).at(-1))
  port.emit('message', { type: MCP_STDIO_PROTOCOL.closeResult, requestId: reopenedMessage.requestId,
    sessionId: reopenedMessage.sessionId, ok: true })
  await reopenedClose
})

test('an open deadline drains until a late physical-close acknowledgement and never reports an unobserved rejection', async t => {
  const port = new EventEmitter() as EventEmitter & { sent: any[]; postMessage(value: any): void }
  port.sent = []
  port.postMessage = message => { port.sent.push(message) }
  const runtime = installMcpStdioRuntime(port as any, { openTimeoutMs: 15, requestMs: 100, maxSessions: 1 })
  t.after(async () => { await runtime?.close().catch(() => {}) })
  const session = runtime!.open(reference, binding, { isCurrent: () => true, purpose: 'inspect' })
  const request = session.request('tools/list', {})
  const openMessage = await waitFor(() => port.sent.find(message => message.type === MCP_STDIO_PROTOCOL.open))
  await assert.rejects(request, (error: any) => error?.code === 'timeout')
  const closeMessage = await waitFor(() => port.sent.find(message => message.type === MCP_STDIO_PROTOCOL.close))
  await new Promise(resolve => setTimeout(resolve, 20))
  await assert.rejects(session.close(), (error: any) => error?.code === 'timeout')
  assert.throws(() => runtime!.open(reference, binding, { isCurrent: () => true, purpose: 'inspect' }), (error: any) => error?.code === 'busy')
  // A late open success cannot resurrect a locally timed-out operation.
  port.emit('message', { type: MCP_STDIO_PROTOCOL.openResult, requestId: openMessage.requestId,
    sessionId: openMessage.sessionId, ok: true })
  port.emit('message', { type: MCP_STDIO_PROTOCOL.closeResult, requestId: closeMessage.requestId,
    sessionId: closeMessage.sessionId, ok: true })
  await session.closed
  const recovered = runtime!.open(reference, binding, { isCurrent: () => true, purpose: 'inspect' })
  const recoveredClose = recovered.close()
  const recoveredMessage = await waitFor(() => port.sent.filter(message => message.type === MCP_STDIO_PROTOCOL.close).at(-1))
  port.emit('message', { type: MCP_STDIO_PROTOCOL.closeResult, requestId: recoveredMessage.requestId,
    sessionId: recoveredMessage.sessionId, ok: true })
  await recoveredClose
})

test('closing before a request rejects it without dispatching protocol work', async t => {
  const { utility, native } = pair(), conn = connection()
  const host = createMcpStdioHost(native as any, { open: async () => conn.value,
    synchronize: async () => ({ available: true }), isCurrent: () => true })
  const runtime = installMcpStdioRuntime(utility)
  t.after(async () => { conn.value.finish(); await runtime?.close().catch(() => {}); await host.close() })
  const session = runtime!.open(reference, binding, { isCurrent: () => true, purpose: 'inspect' })
  const closing = session.close()
  await assert.rejects(session.request('tools/list', {}), /failed/)
  conn.value.finish()
  await closing
  await session.closed
  assert.deepEqual(conn.calls, [])
})

test('a rejected asynchronous open is observed even when no caller awaits a session request', async t => {
  const { utility, native } = pair()
  const host = createMcpStdioHost(native as any, { open: async () => { throw Object.assign(new Error('private opener detail'), { code: 'unavailable' }) },
    synchronize: async () => ({ available: true }), isCurrent: () => true })
  const runtime = installMcpStdioRuntime(utility, { openTimeoutMs: 100 })
  t.after(async () => { await runtime?.close().catch(() => {}); await host.close() })
  runtime!.open(reference, binding, { isCurrent: () => true, purpose: 'inspect' })
  const result = await waitFor(() => native.sent.find(message => message.type === MCP_STDIO_PROTOCOL.openResult))
  assert.equal(result.ok, false)
  assert.equal(result.error, 'unavailable')
  assert.equal(JSON.stringify(native.sent).includes('private opener detail'), false)
  await tick()
  assert.equal(host.activeSessions, 0)
})

test('a timed-out ignored call remains bounded by the physical session and releases capacity only after close proof', async t => {
  const { utility, native } = pair()
  let finishPhysical!: () => void
  const physicalClosed = new Promise<void>(resolve => { finishPhysical = resolve })
  const calls: string[] = []
  const conn = {
    request: (method: string, _params: unknown) => {
      calls.push(method)
      return method === 'tools/call' ? new Promise(() => {}) : Promise.resolve({ tools: [] })
    },
    initialized: async () => {}, close: () => {}, closed: physicalClosed,
  }
  const host = createMcpStdioHost(native as any, { open: async () => conn,
    synchronize: async () => ({ available: true }), isCurrent: () => true, maxSessions: 1, maxPendingCalls: 1 })
  const runtime = installMcpStdioRuntime(utility, { maxSessions: 1, maxPendingCalls: 1 })
  t.after(async () => { finishPhysical(); await runtime?.close().catch(() => {}); await host.close() })
  const session = runtime!.open(reference, binding, { isCurrent: () => true, purpose: 'call' })
  await session.request('tools/list', {})
  const call = session.request('tools/call', { name: 'fixture', arguments: {} }, { beforeDispatch: () => true })
  await waitFor(() => calls.includes('tools/call') ? true : undefined)
  const close = session.close()
  await assert.rejects(call, /failed/)
  assert.equal(host.activeSessions, 1)
  assert.throws(() => runtime!.open(reference, binding, { isCurrent: () => true, purpose: 'inspect' }), (error: any) => error?.code === 'busy')
  finishPhysical()
  await close
  await session.closed
  assert.equal(host.activeSessions, 0, 'confirmed process closure retires even an abort-ignoring call promise')
  const next = runtime!.open(reference, binding, { isCurrent: () => true, purpose: 'inspect' })
  const nextRequest = next.request('tools/list', {})
  await waitFor(() => host.activeSessions === 1 ? true : undefined)
  // A fresh connection is needed for a healthy second session.
  void nextRequest.catch(() => {})
  const nextClose = next.close()
  finishPhysical()
  await nextClose.catch(() => {})
})

test('malformed and oversized request data is rejected before any IPC dispatch', async t => {
  const port = new EventEmitter() as EventEmitter & { sent: any[]; postMessage(value: any): void }
  port.sent = []
  port.postMessage = message => { port.sent.push(message) }
  const runtime = installMcpStdioRuntime(port as any, { openTimeoutMs: 100 })
  t.after(async () => { await runtime?.close().catch(() => {}) })
  let getterRead = false
  const hostileBinding = Object.defineProperty({}, 'tenantId', { enumerable: true, get() { getterRead = true; return binding.tenantId } })
  assert.throws(() => runtime!.open(reference, hostileBinding, { isCurrent: () => true, purpose: 'inspect' }), (error: any) => error?.code === 'invalid')
  assert.equal(getterRead, false)
  assert.equal(port.sent.length, 0)

  const session = runtime!.open(reference, binding, { isCurrent: () => true, purpose: 'inspect' })
  const openMessage = await waitFor(() => port.sent.find(message => message.type === MCP_STDIO_PROTOCOL.open))
  port.emit('message', { type: MCP_STDIO_PROTOCOL.openResult, requestId: openMessage.requestId,
    sessionId: openMessage.sessionId, ok: true })
  const baseline = port.sent.length
  let paramGetterRead = false
  const params = Object.defineProperty({}, 'name', { enumerable: true, get() { paramGetterRead = true; return 'x' } })
  await assert.rejects(session.request('tools/list', params), (error: any) => error?.code === 'invalid')
  await assert.rejects(session.request('tools/list', { payload: 'x'.repeat(1_048_577) }), (error: any) => error?.code === 'limit')
  assert.equal(paramGetterRead, false)
  assert.equal(port.sent.length, baseline, 'bad requests are rejected before request IDs are submitted')
  const closing = session.close()
  const closeMessage = await waitFor(() => port.sent.find(message => message.type === MCP_STDIO_PROTOCOL.close))
  port.emit('message', { type: MCP_STDIO_PROTOCOL.closeResult, requestId: closeMessage.requestId,
    sessionId: closeMessage.sessionId, ok: true })
  await closing
})
