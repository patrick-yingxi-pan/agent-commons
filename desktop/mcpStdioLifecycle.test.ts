import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createMcpStdioLifecycle, snapshotMcpStdioLifecycleBinding, MCP_STDIO_LIFECYCLE_LIMITS as LIMITS } from './mcpStdioLifecycle.mjs'
import { McpStdioGrantError } from './mcpStdioGrantVault.mjs'
import { createMcpStdioSetup } from './mcpStdioSetup.mjs'

const ref = (number = 1) => `MCP_STDIO_${number.toString(16).toUpperCase().padStart(32, '0')}`
const binding = (connectionRevision = 0, ownerUserId = 'user-fixture', number = 1) => ({ tenantId: 'tenant-fixture', ownerUserId,
  connectionId: `mcp-connection-${number.toString(16).padStart(32, '0')}`, connectionRevision })
const binding3 = (value = binding()) => { const { connectionRevision: _revision, ...rest } = value; return rest }
const launch = () => ({ executable: '/private/repository-fixture', args: [], cwd: '/private', env: { FIXTURE: 'literal' } })
const options = () => ({ isCurrent: () => true })
const row = (reference = null, value = binding()) => ({ reference, binding: value })
const turn = () => new Promise(resolve => setImmediate(resolve))
const code = expected => error => error instanceof McpStdioGrantError && error.code === expected && !error.message.includes('PRIVATE')
const attempt = operation => Promise.resolve().then(operation)

function harness(t, overrides = {}) {
  const custody = new Map(), configured = [], reconciled = [], opened = [], discarded = [], completions = []
  let sequence = 0, closes = 0
  const vault = {
    async reconcile(rows, opts) {
      reconciled.push(structuredClone(rows))
      assert.equal(opts.isCurrent(), true)
      if (overrides.reconcile) return overrides.reconcile(rows, opts)
      const keep = new Map(rows.map(entry => [entry.reference, entry.binding]))
      for (const [reference, value] of custody) if (!keep.has(reference) || JSON.stringify(keep.get(reference)) !== JSON.stringify(value)) custody.delete(reference)
      return [...keep].every(([reference, value]) => JSON.stringify(custody.get(reference)) === JSON.stringify(value))
    },
    async discard(reference, value, opts) {
      discarded.push([reference, value])
      assert.equal(opts.isCurrent(), true)
      if (overrides.discard) return overrides.discard(reference, value, opts)
      if (JSON.stringify(custody.get(reference)) === JSON.stringify(value)) custody.delete(reference)
    },
  }
  const authority = {
    async configure(value, config, opts) {
      configured.push([value, config, opts])
      assert.equal(opts.isCurrent(), true)
      const reference = ref(++sequence)
      if (overrides.configure) await overrides.configure(reference, value, opts)
      custody.set(reference, value)
      return reference
    },
    async open(reference, value, opts) {
      opened.push([reference, value, opts])
      if (overrides.open) return overrides.open(reference, value, opts)
      assert.equal(opts.isCurrent(), true)
      const completion = Promise.withResolvers(); completions.push(completion)
      return { closed: completion.promise, close: () => completion.resolve({ code: 'closed' }) }
    },
    close() { closes += 1 },
  }
  const lifecycle = createMcpStdioLifecycle({ vault, authority })
  t.after(() => { lifecycle.close(); for (const completion of completions) completion.resolve({ code: 'closed' }) })
  return { lifecycle, custody, configured, reconciled, opened, discarded, completions, get closes() { return closes } }
}

test('startup waits for a strict authoritative snapshot, removes only orphan custody, and never launches', async t => {
  const h = harness(t)
  h.custody.set(ref(1), binding3()); h.custody.set(ref(2), binding3(binding(0, 'user-other')))
  await assert.rejects(attempt(() => h.lifecycle.configure(binding3(), launch(), options())), code('unavailable'))
  await assert.rejects(h.lifecycle.open(ref(), binding(), { ...options(), purpose: 'call' }), code('unavailable'))
  assert.equal(await h.lifecycle.initialize([row(ref())]), true)
  assert.equal(h.lifecycle.usable, true)
  assert.deepEqual([...h.custody.keys()], [ref()])
  assert.equal(h.opened.length + h.configured.length, 0)
  assert.equal(h.lifecycle.isCurrent(ref(), binding(), 'call'), true)
  assert.equal(h.lifecycle.isCurrent(ref(), binding(), 'inspect'), false, 'saved authority is not native inspection consent')
})

test('null-reference connection rows admit exact native setup; untracked references and revisions grant nothing', async t => {
  const h = harness(t)
  assert.equal(await h.lifecycle.initialize([row(), row(null, binding(0, 'user-fixture', 2))]), true)
  const pending = await h.lifecycle.configure(binding3(), launch(), options())
  assert.equal(pending, ref())
  assert.equal(h.lifecycle.isCurrent(pending, binding(), 'call'), false)
  assert.throws(() => h.lifecycle.permitSetup(ref(9), binding(), options()), code('stale'))
  assert.throws(() => h.lifecycle.permitSetup(pending, binding(1), options()), code('stale'))
  assert.throws(() => h.lifecycle.permitSetup(pending, binding(0, 'user-other'), options()), code('stale'))
  const permit = h.lifecycle.permitSetup(pending, binding(), options())
  assert.equal(Object.isFrozen(permit), true)
  assert.equal(h.lifecycle.isCurrent(pending, binding(), 'inspect'), true)
  assert.equal(h.lifecycle.completeSetup(pending, {}), false, 'caller-made tokens do not end another setup')
  assert.equal(h.lifecycle.cancelSetup(pending, permit), true)
  assert.equal(h.lifecycle.isCurrent(pending, binding(), 'inspect'), false)
  assert.equal(await h.lifecycle.synchronize([row()]), true)
  assert.ok(h.custody.has(pending), 'lost-ACK setup custody survives ordinary snapshots')
  assert.equal(await h.lifecycle.synchronize([row(pending)]), true)
  assert.equal(h.lifecycle.isCurrent(pending, binding(), 'call'), true)
  assert.equal(await h.lifecycle.abandonSetup(pending, binding()), false, 'adopted grants cannot be abandoned as provisional')
})

test('one native inspection permit allows at most two sequential processes and current checks do not consume allowance', async t => {
  const h = harness(t)
  await h.lifecycle.initialize([row()])
  const reference = await h.lifecycle.configure(binding3(), launch(), options())
  const permit = h.lifecycle.permitSetup(reference, binding(), options())
  for (let index = 0; index < 10; index += 1) assert.equal(h.lifecycle.isCurrent(reference, binding(), 'inspect'), true)
  const first = await h.lifecycle.open(reference, binding(), { ...options(), purpose: 'inspect' })
  assert.deepEqual(h.opened[0].slice(0, 2), [reference, binding3()])
  await assert.rejects(h.lifecycle.open(reference, binding(), { ...options(), purpose: 'inspect' }), code('capacity'))
  await assert.rejects(h.lifecycle.open(reference, binding(), { ...options(), purpose: 'call' }), code('stale'))
  first.close(); await turn()
  const second = await h.lifecycle.open(reference, binding(), { ...options(), purpose: 'inspect' })
  second.close(); await turn()
  await assert.rejects(h.lifecycle.open(reference, binding(), { ...options(), purpose: 'inspect' }), code('capacity'))
  assert.equal(h.opened.length, 2)
  assert.equal(h.lifecycle.completeSetup(reference, permit), true)
  assert.equal(h.lifecycle.isCurrent(reference, binding(), 'inspect'), false)
  assert.equal(h.opened[1][2].signal.aborted, true)
})

test('saved refs also require explicit inspection permits and source cancellation revokes immediately', async t => {
  const h = harness(t); h.custody.set(ref(), binding3())
  await h.lifecycle.initialize([row(ref())])
  await assert.rejects(h.lifecycle.open(ref(), binding(), { ...options(), purpose: 'inspect' }), code('stale'))
  const abort = new AbortController()
  h.lifecycle.permitSetup(ref(), binding(), { ...options(), signal: abort.signal })
  await h.lifecycle.open(ref(), binding(), { ...options(), purpose: 'inspect' })
  abort.abort()
  assert.equal(h.opened[0][2].signal.aborted, true)
  assert.equal(h.lifecycle.isCurrent(ref(), binding(), 'inspect'), false)
  assert.equal(h.lifecycle.isCurrent(ref(), binding(), 'call'), true)
})

test('failed process-open acknowledgement retires its inspection transaction instead of granting an unobserved fallback', async t => {
  const h = harness(t, { open: async () => { throw new Error('PRIVATE open diagnostics') } })
  await h.lifecycle.initialize([row()])
  const reference = await h.lifecycle.configure(binding3(), launch(), options())
  h.lifecycle.permitSetup(reference, binding(), options())
  await assert.rejects(h.lifecycle.open(reference, binding(), { ...options(), purpose: 'inspect' }), code('unavailable'))
  assert.equal(h.lifecycle.isCurrent(reference, binding(), 'inspect'), false)
  await assert.rejects(h.lifecycle.open(reference, binding(), { ...options(), purpose: 'inspect' }), code('stale'))
  assert.equal(h.opened.length, 1)
})

test('removed, disconnected and revision-changed rows revoke active inspection before sync acknowledgement', async t => {
  for (const next of [[], [row(null, binding(1))], [row(ref(), binding(1))]]) {
    let blocker
    const h = harness(t, { reconcile: async () => blocker ? blocker.promise : true })
    await h.lifecycle.initialize([row(ref())])
    h.lifecycle.permitSetup(ref(), binding(), options())
    await h.lifecycle.open(ref(), binding(), { ...options(), purpose: 'inspect' })
    blocker = Promise.withResolvers()
    const syncing = h.lifecycle.synchronize(next)
    assert.equal(h.opened[0][2].signal.aborted, true)
    assert.equal(h.lifecycle.isCurrent(ref(), binding(), 'inspect'), false)
    blocker.resolve(true); assert.equal(await syncing, true)
  }
})

test('failed cleanup never regrants removed authority; explicit synchronization repairs without dispatch', async t => {
  let failure = false
  const h = harness(t, { reconcile: async () => { if (failure) throw new Error('PRIVATE cleanup'); return true } })
  await h.lifecycle.initialize([row(ref())])
  await h.lifecycle.open(ref(), binding(), { ...options(), purpose: 'call' })
  failure = true
  const work = h.lifecycle.synchronize([row(null, binding(1))])
  assert.equal(h.opened[0][2].signal.aborted, true)
  assert.equal(h.lifecycle.isCurrent(ref(), binding(), 'call'), false)
  assert.equal(await work, false)
  assert.equal(h.lifecycle.usable, false); assert.equal(h.lifecycle.cleanupPending, true)
  assert.equal(await h.lifecycle.synchronize([row(ref())]), false, 'stale snapshots cannot resurrect pending retirement')
  failure = false
  assert.equal(await h.lifecycle.synchronize([row(null, binding(1))]), true)
  assert.equal(h.lifecycle.usable, true); assert.equal(h.lifecycle.cleanupPending, false)
  assert.equal(h.opened.length, 1)
})

test('configuration acknowledgement outlives cancellation and precedes queued orphan reconciliation', async t => {
  const commit = Promise.withResolvers(), reached = Promise.withResolvers(), abort = new AbortController()
  const h = harness(t, { configure: async () => { reached.resolve(); await commit.promise } })
  await h.lifecycle.initialize([row()])
  const configure = h.lifecycle.configure(binding3(), launch(), { ...options(), signal: abort.signal })
  await reached.promise
  abort.abort()
  const syncing = h.lifecycle.synchronize([row()])
  assert.equal(h.reconciled.length, 1, 'sync must not erase a grant before its late durable acknowledgement registers')
  commit.resolve()
  assert.equal(await configure, ref())
  assert.equal(await syncing, true)
  assert.deepEqual(h.reconciled.at(-1), [{ reference: ref(), binding: binding3() }])
  assert.ok(h.custody.has(ref()))
  assert.equal(h.opened.length, 0)
})

test('pre-POST abandon deletes only tracked unadopted grants and retains failed cleanup for explicit repair', async t => {
  let failure = true
  const h = harness(t, { discard: async () => { if (failure) throw new Error('PRIVATE cleanup'); h.custody.delete(ref()) } })
  await h.lifecycle.initialize([row()])
  const reference = await h.lifecycle.configure(binding3(), launch(), options())
  h.lifecycle.permitSetup(reference, binding(), options())
  await h.lifecycle.open(reference, binding(), { ...options(), purpose: 'inspect' })
  assert.equal(await h.lifecycle.abandonSetup(ref(9), binding()), false)
  assert.equal(await h.lifecycle.abandonSetup(reference, binding(1)), false)
  const abandoning = h.lifecycle.abandonSetup(reference, binding())
  assert.equal(h.opened[0][2].signal.aborted, true)
  assert.equal(await abandoning, false)
  assert.equal(h.lifecycle.cleanupPending, true); assert.equal(h.lifecycle.usable, false)
  assert.equal(await h.lifecycle.synchronize([row(reference)]), false, 'failed abandon cannot be regranted')
  failure = false
  assert.equal(await h.lifecycle.abandonSetup(reference, binding()), true)
  assert.equal(await h.lifecycle.synchronize([row()]), true)
  assert.equal(h.custody.has(reference), false)
  assert.equal(h.discarded.length, 2)
})

test('startup malformed snapshots fail closed without erasing custody or reading accessor-backed data', async t => {
  const badRows = [undefined, {}, Array(1), [row(), row()], [row(ref()), row(ref(), binding(0, 'user-other'))],
    [row(null, { ...binding(), extra: true })], [row(null, binding(-1))],
    [{ get reference() { assert.fail('snapshot getter must not execute') }, binding: binding() }],
    Array.from({ length: LIMITS.bindings + 1 }, (_, index) => row(null, binding(0, 'user-fixture', index + 1)))]
  for (const rows of badRows) {
    const h = harness(t); h.custody.set(ref(), binding3())
    assert.equal(await h.lifecycle.initialize(rows), false)
    assert.equal(h.lifecycle.usable, false)
    assert.equal(h.reconciled.length, 0)
    assert.ok(h.custody.has(ref()))
    assert.equal(h.lifecycle.isCurrent(ref(), binding(), 'call'), false)
  }
  assert.equal(snapshotMcpStdioLifecycleBinding({ ...binding(), get connectionRevision() { assert.fail('binding getter must not execute') } }), null)
})

test('source-fence callbacks cannot close or cancel a permit and still return current authority', async t => {
  const h = harness(t)
  await h.lifecycle.initialize([row()])
  const reference = await h.lifecycle.configure(binding3(), launch(), options())
  let revoke = false, token
  token = h.lifecycle.permitSetup(reference, binding(), { isCurrent() { if (revoke) h.lifecycle.cancelSetup(reference, token); return true } })
  revoke = true
  assert.equal(h.lifecycle.isCurrent(reference, binding(), 'inspect'), false)
  await assert.rejects(h.lifecycle.open(reference, binding(), { ...options(), purpose: 'inspect' }), code('stale'))
  assert.equal(h.opened.length, 0)
})

test('shutdown aborts processes and pending setup without rewriting custody or replaying; late commit remains recoverable', async t => {
  const commit = Promise.withResolvers(), reached = Promise.withResolvers()
  const h = harness(t, { configure: async () => { reached.resolve(); await commit.promise } })
  h.custody.set(ref(99), binding3())
  await h.lifecycle.initialize([row(ref(99))])
  await h.lifecycle.open(ref(99), binding(), { ...options(), purpose: 'call' })
  const configuring = h.lifecycle.configure(binding3(), launch(), options())
  await reached.promise
  h.lifecycle.close(); h.lifecycle.close()
  assert.equal(h.opened[0][2].signal.aborted, true)
  assert.equal(h.closes, 1)
  commit.resolve(); assert.equal(await configuring, ref())
  assert.ok(h.custody.has(ref())); assert.ok(h.custody.has(ref(99)))
  assert.equal(await h.lifecycle.synchronize([]), false)
  assert.equal(h.discarded.length, 0); assert.equal(h.reconciled.length, 1)
  assert.equal(h.opened.length, 1)
})

test('queued custody work is bounded while an ignored native commit drains', async t => {
  const commit = Promise.withResolvers(), reached = Promise.withResolvers()
  const h = harness(t, { configure: async () => { reached.resolve(); await commit.promise } })
  await h.lifecycle.initialize([row()])
  const jobs = [h.lifecycle.configure(binding3(), launch(), options())]
  await reached.promise
  for (let index = 1; index < LIMITS.pending; index += 1) jobs.push(h.lifecycle.configure(binding3(), launch(), options()))
  await assert.rejects(attempt(() => h.lifecycle.configure(binding3(), launch(), options())), code('capacity'))
  assert.equal(h.configured.length, 1)
  commit.resolve(); await Promise.all(jobs)
  assert.equal(h.configured.length, LIMITS.pending)
})

test('real setup owner and lifecycle compose old-revision inspection, durable new-revision adoption and GET-only lost-ACK recovery', async t => {
  for (const loseAcknowledgement of [false, true]) {
    const h = harness(t)
    await h.lifecycle.initialize([row()])
    let latest = { stamp: 'fixture-source', binding: binding(),
      connection: { revision: 0, status: 'unverified', inspectionOperationId: null } }
    let inspections = 0, reads = 0
    const setup = createMcpStdioSetup({ lifecycle: h.lifecycle, assertCaller: () => true, source: {
      isSourceCurrent: stamp => stamp === 'fixture-source',
      resolveSource: async () => { reads += 1; return structuredClone(latest) },
      async inspect(source, request, opts) {
        assert.equal(opts.beforeSubmit(), true)
        assert.equal(request.expectedRevision, 0)
        inspections += 1
        const connection = await h.lifecycle.open(request.grantReference, source.binding,
          { ...options(), purpose: 'inspect', signal: opts.signal })
        connection.close(); await connection.closed
        latest = { ...latest, binding: binding(1), connection: { revision: 1, status: 'connected', inspectionOperationId: request.operationId } }
        assert.equal(await h.lifecycle.synchronize([row(request.grantReference, binding(1))]), true)
        if (loseAcknowledgement) throw new Error('lost acknowledgement')
        return structuredClone(latest)
      },
      close() {},
    } })
    t.after(() => setup.close())
    const prepared = await setup.start({}, { connectionId: binding().connectionId, launch: launch(),
      expectedRevision: binding().connectionRevision, source: { tenantId: binding().tenantId, userId: binding().ownerUserId } })
    const result = await setup.authorize({}, { flowId: prepared.flowId })
    assert.equal(result.status, loseAcknowledgement ? 'uncertain' : 'connected')
    const priorReads = reads
    assert.equal((await setup.reconcile({}, { flowId: prepared.flowId })).status, 'connected')
    assert.equal(reads, priorReads + 1)
    assert.equal(h.lifecycle.isCurrent(ref(), binding(), 'inspect'), false)
    assert.equal(h.lifecycle.isCurrent(ref(), binding(1), 'call'), true)
    assert.equal((await setup.authorize({}, { flowId: prepared.flowId })).status, 'connected')
    assert.equal(h.configured.length, 1); assert.equal(inspections, 1); assert.equal(h.opened.length, 1)
    assert.equal(h.discarded.length, 0)
    assert.doesNotMatch(JSON.stringify({ prepared, result }), /MCP_STDIO|executable|FIXTURE/)
  }
})
