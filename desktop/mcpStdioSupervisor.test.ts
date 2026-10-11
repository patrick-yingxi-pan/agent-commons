import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough, Writable } from 'node:stream'
import { test } from 'node:test'
import { createMcpStdioSupervisor, MCP_STDIO_PROCESS_LIMITS as LIMITS, McpStdioError } from './mcpStdioSupervisor.mjs'

const launch = () => ({ executable: '/private/repo-fixture', args: ['literal; $(no shell)'], cwd: '/private', env: { FIXTURE: 'explicit' } })
const errorCode = (code, submitted = false) => error => {
  assert.ok(error instanceof McpStdioError)
  assert.equal(error.code, code)
  assert.equal(error.mayHaveSubmitted, submitted)
  assert.equal(error.message, `The local MCP transport failed (${code}).`)
  return true
}
function harness(t, options = {}) {
  const children = [], calls = [], timers = new Map()
  const supervisor = createMcpStdioSupervisor({
    targetPlatform: 'darwin',
    spawnProcess(...args) {
      calls.push(args)
      const child = new EventEmitter()
      child.pid = 10_000 + children.length
      child.writes = []
      child.kills = []
      child.stdin = new Writable({ write(bytes, _encoding, done) { child.writes.push(Buffer.from(bytes)); done() } })
      child.stdout = new PassThrough()
      child.stderr = new PassThrough()
      child.kill = signal => { child.kills.push(signal); return true }
      child.reply = (result, id = 1) => child.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n')
      children.push(child)
      return child
    },
    signalProcess(pid, signal) { const child = children.find(child => child.pid === -pid); assert.ok(child); child.kills.push(signal) },
    setTimer(fn, ms) { const id = {}; timers.set(id, { fn, ms }); return id },
    clearTimer(id) { timers.delete(id) },
    ...options,
  })
  t.after(() => { supervisor.dispose(); for (const child of children) child.emit('close'); assert.equal(timers.size, 0) })
  return {
    supervisor, children, calls, timers,
    open: (options = {}) => supervisor.open(launch(), { isCurrent: () => true, ...options }),
    fire(ms) { const entry = [...timers].find(([, timer]) => timer.ms === ms); assert.ok(entry, `timer ${ms}`); timers.delete(entry[0]); entry[1].fn() },
  }
}

test('stdio launches exactly once without ambient env/shell and emits independent bounded RPC IDs', async t => {
  const h = harness(t)
  const connection = h.open()
  assert.deepEqual(h.calls, [[launch().executable, launch().args, {
    cwd: '/private', env: { FIXTURE: 'explicit' }, shell: false, detached: true,
    stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  }]])
  const first = connection.request('server/discover', { _meta: { explicit: true } })
  assert.deepEqual(JSON.parse(h.children[0].writes[0].toString()), { jsonrpc: '2.0', id: 1, method: 'server/discover', params: { _meta: { explicit: true } } })
  h.children[0].reply({ supportedVersions: ['2026-07-28'] })
  assert.deepEqual(await first, { jsonrpc: '2.0', id: 1, result: { supportedVersions: ['2026-07-28'] } })
  await connection.initialized()
  assert.deepEqual(JSON.parse(h.children[0].writes[1].toString()), { jsonrpc: '2.0', method: 'notifications/initialized', params: {} })
  const second = connection.request('tools/list')
  h.children[0].reply({ tools: [] }, 2)
  assert.equal((await second).id, 2)
  const completion = connection.close()
  h.children[0].emit('close', 0)
  assert.deepEqual(await completion, { code: 'closed' })
  assert.equal(h.calls.length, 1)
})

test('launch preflight requires a current synchronous identity and explicit macOS config', t => {
  const h = harness(t)
  for (const options of [{}, { isCurrent: () => false }, { isCurrent: async () => true }, { isCurrent: () => { throw new Error('PRIVATE') } }]) {
    assert.throws(() => h.supervisor.open(launch(), options), errorCode(options.isCurrent ? 'stale' : 'invalid'))
  }
  assert.throws(() => h.supervisor.open({ ...launch(), executable: 'relative' }, { isCurrent: () => true }), errorCode('invalid'))
  assert.throws(() => h.open({ signal: AbortSignal.abort() }), errorCode('cancelled'))
  assert.equal(h.calls.length, 0)
  const unsupported = createMcpStdioSupervisor({ targetPlatform: 'linux', spawnProcess: () => assert.fail('no spawn') })
  assert.throws(() => unsupported.open(launch(), { isCurrent: () => true }), errorCode('unavailable'))
})

test('launch rechecks cancellation and disposal after the identity callback', t => {
  const h = harness(t), abort = new AbortController()
  assert.throws(() => h.open({ signal: abort.signal, isCurrent() { abort.abort(); return true } }), errorCode('cancelled'))
  assert.throws(() => h.open({ isCurrent() { h.supervisor.dispose(); return true } }), errorCode('cancelled'))
  assert.equal(h.calls.length, 0, 'a callback that revokes launch authority cannot spawn a process')
})

test('calls are serialized, detached and never accept caller-selected IDs or arbitrary methods', async t => {
  const h = harness(t), connection = h.open()
  for (const method of ['other', 'notifications/cancelled', 'sampling/createMessage']) {
    await assert.rejects(connection.request(method, {}), errorCode('invalid'))
  }
  const unsafe = { get secret() { assert.fail('getter not invoked') } }
  await assert.rejects(connection.request('tools/call', unsafe), errorCode('invalid'))
  await assert.rejects(connection.request('tools/call', []), errorCode('invalid'))
  await assert.rejects(connection.request('tools/call', { value: 'a'.repeat(1_048_576) }), errorCode('limit'))
  assert.equal(h.children[0].writes.length, 0)
  const params = { name: 'fixture', arguments: { text: 'before' } }
  const call = connection.request('tools/call', params)
  params.arguments.text = 'after'
  assert.equal(JSON.parse(h.children[0].writes[0].toString()).params.arguments.text, 'before')
  await assert.rejects(connection.request('tools/list'), errorCode('busy'))
  await assert.rejects(connection.initialized(), errorCode('busy'))
  h.children[0].reply({ content: [] })
  await call
  assert.equal(h.children[0].writes.length, 1)
})

test('beforeDispatch requires a synchronous exact-true result and rechecks identity and cancellation afterward', async t => {
  const refused = [
    () => false,
    () => { throw new Error('PRIVATE') },
    async () => false,
    () => Promise.reject(new Error('PRIVATE REJECTION')),
    () => ({ then(_resolve, reject) { reject(new Error('PRIVATE THENABLE')) } }),
    'not-a-function',
  ]
  for (const beforeDispatch of refused) {
    const h = harness(t), connection = h.open()
    const pending = connection.request('tools/call', {}, { beforeDispatch })
    if (h.children[0].writes.length) h.children[0].reply({ unexpected: true })
    await assert.rejects(pending, errorCode('stale', false))
    assert.equal(h.children[0].writes.length, 0, 'guard refusal submits no bytes')
  }

  const abort = new AbortController()
  const h = harness(t), connection = h.open()
  const cancelled = connection.request('tools/call', {}, {
    signal: abort.signal,
    beforeDispatch() { abort.abort(); return true },
  })
  if (h.children[0].writes.length) h.children[0].reply({ unexpected: true })
  await assert.rejects(cancelled, errorCode('cancelled', false))
  assert.equal(h.children[0].writes.length, 0, 'a synchronous abort from the guard wins before write')

  let current = true
  const changed = harness(t), guarded = changed.open({ isCurrent: () => current })
  const stale = guarded.request('tools/call', {}, { beforeDispatch() { current = false; return true } })
  if (changed.children[0].writes.length) changed.children[0].reply({ unexpected: true })
  await assert.rejects(stale, errorCode('stale', false))
  assert.equal(changed.children[0].writes.length, 0, 'authority is checked again after the hook')

  let approvals = 0
  const approved = harness(t), permitted = approved.open()
  const completed = permitted.request('tools/call', {}, { beforeDispatch() { approvals += 1; return true } })
  assert.equal(approved.children[0].writes.length, 1)
  approved.children[0].reply({ accepted: true })
  assert.deepEqual(await completed, { jsonrpc: '2.0', id: 1, result: { accepted: true } })
  assert.equal(approvals, 1)
})

test('a guard that closes its connection cannot write after the operation was settled', async t => {
  const h = harness(t), connection = h.open(), child = h.children[0]
  let writeAttempts = 0
  const write = child.stdin.write.bind(child.stdin)
  child.stdin.write = (...args) => { writeAttempts += 1; return write(...args) }
  let closing
  const pending = connection.request('tools/call', {}, {
    beforeDispatch() { closing = connection.close(); return true },
  })
  await assert.rejects(pending, errorCode('closed', false))
  assert.equal(writeAttempts, 0, 'the supervisor never attempts a write after close')
  assert.equal(child.writes.length, 0, 'close inside the final guard submits no request bytes')
  child.emit('close', 0)
  await closing
})

test('invalid or accessor-backed request metadata is rejected before cancellation metadata can be retained', async t => {
  const h = harness(t), connection = h.open()
  let getterCalls = 0
  const accessorMeta = {}
  Object.defineProperty(accessorMeta, '_meta', { enumerable: true, get() { getterCalls += 1; return {} } })
  for (const params of [{ _meta: 'not-an-object' }, accessorMeta]) {
    const pending = connection.request('tools/call', params)
    if (h.children[0].writes.length) h.children[0].reply({ unexpected: true })
    await assert.rejects(pending, errorCode('invalid', false))
  }
  assert.equal(getterCalls, 0)
  assert.equal(h.children[0].writes.length, 0)
})

test('notifications are inert; matching protocol errors remain data, not native diagnostics', async t => {
  const h = harness(t), connection = h.open(), child = h.children[0]
  const call = connection.request('server/discover')
  child.stdout.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/message', params: { data: 'SECRET https://never-open.example' } }) + '\n')
  const error = { jsonrpc: '2.0', id: 1, error: { code: -32022, message: 'remote untrusted text', data: { supportedVersions: ['2025-11-25'] } } }
  child.stdout.write(JSON.stringify(error) + '\n')
  assert.deepEqual(await call, error)
  assert.equal(child.writes.length, 1)
  assert.equal(child.kills.length, 0)
})

test('server requests, wrong IDs, mixed envelopes and duplicate responses terminate without dispatch', async t => {
  const invalids = [
    { jsonrpc: '2.0', id: 2, result: {} },
    { jsonrpc: '2.0', id: 1, method: 'sampling/createMessage', params: {} },
    { jsonrpc: '2.0', id: 1, result: {}, error: { code: 1, message: 'PRIVATE' } },
    { jsonrpc: '2.0', id: 1, error: { code: '1', message: 'PRIVATE' } },
    { jsonrpc: '2.0', method: 'notifications/progress', params: [] },
    { jsonrpc: '1.0', id: 1, result: {} },
  ]
  for (const row of invalids) {
    const h = harness(t), connection = h.open(), child = h.children[0]
    const rejected = assert.rejects(connection.request('tools/call', { name: 'fixture' }), errorCode('protocol', true))
    child.stdout.write(JSON.stringify(row) + '\n')
    await rejected
    assert.equal(child.writes.length, 1)
    assert.equal(h.calls.length, 1)
    child.emit('close')
  }
  const h = harness(t), connection = h.open()
  const rejected = assert.rejects(connection.request('tools/list'), errorCode('protocol', true))
  const response = JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }) + '\n'
  h.children[0].stdout.write(response + response)
  await rejected
})

test('abort submits one cancellation, fences late output, and retains capacity through TERM/KILL until close', async t => {
  const h = harness(t), abort = new AbortController()
  const connections = Array.from({ length: LIMITS.capacity }, () => h.open())
  const rejected = assert.rejects(connections[0].request('tools/call', {}, { signal: abort.signal }), errorCode('cancelled', true))
  abort.abort()
  await rejected
  const child = h.children[0]
  assert.deepEqual(JSON.parse(child.writes[1].toString()), { jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 1 } })
  child.reply({ content: [{ type: 'text', text: 'late secret' }] })
  assert.throws(() => h.open(), errorCode('busy'))
  h.fire(LIMITS.shutdownGraceMs)
  assert.deepEqual(child.kills, ['SIGTERM'])
  h.fire(LIMITS.killGraceMs)
  assert.deepEqual(child.kills, ['SIGTERM', 'SIGKILL'])
  assert.throws(() => h.open(), errorCode('busy'))
  child.emit('close', null, 'SIGKILL')
  assert.deepEqual(await connections[0].closed, { code: 'cancelled' })
  h.open()
  assert.equal(h.children.length, LIMITS.capacity + 1)
  assert.equal(child.writes.length, 2)
})

test('cancellation echoes detached request _meta while metadata-free legacy cancellation stays minimal', async t => {
  const h = harness(t), abort = new AbortController(), connection = h.open()
  const metadata = { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', client: { name: 'fixture' } }
  const params = { name: 'fixture', _meta: metadata }
  const pending = connection.request('tools/call', params, { signal: abort.signal })
  params._meta.client.name = 'mutated-after-snapshot'
  abort.abort()
  await assert.rejects(pending, errorCode('cancelled', true))
  assert.deepEqual(JSON.parse(h.children[0].writes[1].toString()), {
    jsonrpc: '2.0', method: 'notifications/cancelled',
    params: { requestId: 1, _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', client: { name: 'fixture' } } },
  })

  const legacy = harness(t), legacyAbort = new AbortController(), legacyConnection = legacy.open()
  const legacyPending = legacyConnection.request('tools/call', { name: 'legacy-fixture' }, { signal: legacyAbort.signal })
  legacyAbort.abort()
  await assert.rejects(legacyPending, errorCode('cancelled', true))
  assert.deepEqual(JSON.parse(legacy.children[0].writes[1].toString()), {
    jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 1 },
  })
})

test('pre-aborted requests write nothing; host abort and disposal fence every subsequent launch', async t => {
  const h = harness(t), host = new AbortController(), connection = h.open({ signal: host.signal })
  await assert.rejects(connection.request('tools/list', {}, { signal: AbortSignal.abort() }), errorCode('cancelled'))
  assert.equal(h.children[0].writes.length, 0)
  const rejected = assert.rejects(connection.request('tools/call'), errorCode('cancelled', true))
  host.abort()
  await rejected
  await assert.rejects(connection.request('tools/list'), errorCode('cancelled'))
  h.supervisor.dispose()
  assert.throws(() => h.open(), errorCode('cancelled'))
})

test('source changes before dispatch and before publication fail closed without exposing late results', async t => {
  let isCurrent = true
  const h = harness(t), connection = h.open({ isCurrent: () => isCurrent })
  isCurrent = false
  await assert.rejects(connection.request('tools/list'), errorCode('stale'))
  assert.equal(h.children[0].writes.length, 0)
  isCurrent = true
  const another = h.open({ isCurrent: () => isCurrent })
  const rejected = assert.rejects(another.request('tools/call'), errorCode('stale', true))
  isCurrent = false
  h.children[1].reply({ secret: 'must not publish' })
  await rejected
})

test('request and whole-process deadlines never replay and retain capacity until close', async t => {
  const h = harness(t), connection = h.open()
  const rejected = assert.rejects(connection.request('tools/call'), errorCode('timeout', true))
  h.fire(LIMITS.requestMs)
  await rejected
  assert.equal(h.calls.length, 1)
  await assert.rejects(connection.request('tools/list'), errorCode('timeout'))
  const second = h.open()
  h.fire(LIMITS.lifetimeMs)
  await assert.rejects(second.request('tools/list'), errorCode('timeout'))
})

test('stderr is discarded and bounded; malformed or partial stdout is never repaired', async t => {
  for (const [bytes, code] of [[Buffer.from([0xff, 0x0a]), 'protocol'], [Buffer.from('not JSON PRIVATE\n'), 'protocol'], [Buffer.alloc(1_048_577, 0x20), 'limit']]) {
    const h = harness(t), connection = h.open()
    const rejected = assert.rejects(connection.request('tools/list'), errorCode(code, true))
    h.children[0].stdout.write(bytes)
    await rejected
  }
  const h = harness(t), connection = h.open()
  const rejected = assert.rejects(connection.request('tools/list'), errorCode('limit', true))
  h.children[0].stderr.write(Buffer.alloc(LIMITS.maxStderrBytes + 1))
  await rejected
  const partial = h.open()
  const partialRejected = assert.rejects(partial.request('tools/list'), errorCode('protocol', true))
  h.children[1].stdout.end('{"jsonrpc":"2.0"')
  await partialRejected
})

test('request count and cumulative outgoing bytes are bounded across successful calls', async t => {
  const h = harness(t), connection = h.open()
  for (let index = 1; index <= LIMITS.maxRequests; index++) {
    const call = connection.request('tools/list')
    h.children[0].reply({}, index)
    await call
  }
  await assert.rejects(connection.request('tools/list'), errorCode('limit'))
  assert.equal(h.children[0].writes.length, LIMITS.maxRequests)
  const large = h.open()
  for (let index = 1; index <= 2; index++) {
    const call = large.request('tools/call', { value: 'a'.repeat(900_000) })
    h.children[1].reply({}, index)
    await call
  }
  await assert.rejects(large.request('tools/call', { value: 'a'.repeat(900_000) }), errorCode('limit'))
  assert.equal(h.children[1].writes.length, 2)
})

test('spawn/write/stream failures have fixed errors and conservatively retain uncertainty', async t => {
  const unavailable = createMcpStdioSupervisor({ targetPlatform: 'darwin', spawnProcess() { throw new Error('/private/SECRET') } })
  assert.throws(() => unavailable.open(launch(), { isCurrent: () => true }), errorCode('unavailable'))
  for (const stream of ['stdin', 'stdout', 'stderr', 'child']) {
    const h = harness(t), connection = h.open()
    const rejected = assert.rejects(connection.request('tools/call'), errorCode('io', true))
    const child = h.children[0]
    ;(stream === 'child' ? child : child[stream]).emit('error', new Error('/private/SECRET'))
    await rejected
    child.emit('close', 1)
  }
  const h = harness(t), connection = h.open()
  h.children[0].stdin.write = () => { throw new Error('PRIVATE') }
  await assert.rejects(connection.request('tools/call'), errorCode('io', true))
})

test('unexpected process exit is never restarted, even after a possibly executed call', async t => {
  const h = harness(t), connection = h.open()
  const rejected = assert.rejects(connection.request('tools/call'), errorCode('closed', true))
  h.children[0].emit('close', 1)
  await rejected
  await assert.rejects(connection.request('tools/call'), errorCode('closed'))
  assert.equal(h.calls.length, 1)
})

test('leader exit retires group signaling immediately, never on delayed pipe close or old timers', async t => {
  const h = harness(t), connection = h.open(), child = h.children[0]
  const rejected = assert.rejects(connection.request('tools/call'), errorCode('closed', true))
  const priorTimers = [...h.timers.values()]
  child.emit('exit', 1)
  await rejected
  assert.deepEqual(child.kills, ['SIGKILL'])
  assert.equal(h.timers.size, 0)
  // Escaped descendants may hold descriptors after the original group is gone.
  // Neither old callbacks nor delayed close may reuse that numeric identifier.
  for (const timer of priorTimers) timer.fn()
  child.emit('close', 1)
  await connection.closed
  assert.deepEqual(child.kills, ['SIGKILL'])
})
