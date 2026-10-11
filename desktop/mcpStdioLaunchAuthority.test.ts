import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createMcpStdioLaunchAuthority, MCP_STDIO_AUTHORITY_LIMITS as LIMITS } from './mcpStdioLaunchAuthority.mjs'
import { openMcpStdioGrantVault, MCP_STDIO_GRANT_FILE, McpStdioGrantError } from './mcpStdioGrantVault.mjs'
import { createMcpStdioSupervisor, McpStdioError } from './mcpStdioSupervisor.mjs'

const reference = `MCP_STDIO_${'A'.repeat(32)}`
const binding = () => ({ tenantId: 'tenant-fixture', ownerUserId: 'user-fixture', connectionId: `mcp-connection-${'a'.repeat(32)}` })
const launch = () => ({ executable: '/private/repository-fixture', args: ['literal; $(not evaluated)'], cwd: '/private', env: { PRIVATE_FIXTURE: 'explicit-only' } })
const options = () => ({ isCurrent: () => true })
const turn = () => new Promise(resolve => setImmediate(resolve))
const deferred = () => Promise.withResolvers()
const errorCode = code => error => {
  assert.ok(error instanceof McpStdioGrantError)
  assert.equal(error.code, code)
  assert.equal(error.message, `The local MCP launch grant is unavailable (${code}).`)
  assert.equal(error.cause, undefined)
  return true
}
function lease() {
  const controller = new AbortController()
  return { launch: launch(), signal: controller.signal, isCurrent: () => !controller.signal.aborted, controller }
}
function harness(t, overrides = {}) {
  const reviewed = [], provisions = [], reads = [], opens = [], timers = new Map(), completions = []
  const saved = lease()
  const authority = createMcpStdioLaunchAuthority({
    vault: {
      provision(...args) { provisions.push(args); return reference },
      read(...args) { reads.push(args); return saved },
      close() { assert.fail('the authority does not own custody shutdown') },
      discard() { assert.fail('authority shutdown never revokes saved grants') },
      ...overrides.vault,
    },
    supervisor: { open(...args) {
      opens.push(args)
      const completion = deferred(); completions.push(completion)
      return { closed: completion.promise }
    }, ...overrides.supervisor },
    confirmLaunch(...args) { reviewed.push(args); return overrides.confirmLaunch ? overrides.confirmLaunch(...args) : true },
    setTimer(fn, ms) { const id = {}; timers.set(id, { fn, ms }); return id },
    clearTimer(id) { timers.delete(id) },
  })
  t.after(() => { authority.close(); for (const completion of completions) completion.resolve({ code: 'closed' }) })
  return { authority, reviewed, provisions, reads, opens, timers, saved,
    fire() { const entry = [...timers].find(([, value]) => value.ms === LIMITS.reviewMs); assert.ok(entry); timers.delete(entry[0]); entry[1].fn() },
  }
}

test('native review precedes custody, receives detached deeply frozen intent, and never launches a process', async t => {
  const answer = deferred(), h = harness(t, { confirmLaunch: () => answer.promise })
  const sourceBinding = binding(), sourceLaunch = launch(), sourceOptions = options()
  const work = h.authority.configure(sourceBinding, sourceLaunch, sourceOptions)
  assert.equal(h.reviewed.length, 1)
  assert.equal(h.provisions.length, 0)
  const [review, context] = h.reviewed[0]
  for (const value of [review, review.binding, review.launch, review.launch.args, review.launch.env]) assert.equal(Object.isFrozen(value), true)
  assert.ok(context.signal instanceof AbortSignal)
  sourceBinding.ownerUserId = 'other-user'; sourceLaunch.args[0] = 'changed'; sourceLaunch.env.PRIVATE_FIXTURE = 'changed'
  sourceOptions.isCurrent = () => false
  assert.deepEqual(review, { binding: binding(), launch: launch() })
  answer.resolve(true)
  assert.equal(await work, reference)
  assert.equal(h.provisions.length, 1)
  assert.deepEqual(h.provisions[0].slice(0, 2), [binding(), launch()])
  assert.equal(h.opens.length, 0, 'saving a reviewed grant is not process launch or tools/call consent')
  assert.equal(h.timers.size, 0)
})

test('native consent requires exact true; closing, false and truthy values never reach custody', async t => {
  for (const answer of [false, null, undefined, 0, 1, 'true', {}, []]) {
    // A real confirm callback is asynchronous and may resolve to undefined on close.
    const h = harness(t, { confirmLaunch: async () => answer })
    await assert.rejects(h.authority.configure(binding(), launch(), options()), errorCode('cancelled'))
    assert.equal(h.provisions.length, 0)
    assert.equal(h.opens.length, 0)
    assert.equal(h.timers.size, 0)
  }
})

test('options are exact data records: unknown keys, symbols and getters fail without being invoked', async t => {
  const h = harness(t)
  const bad = [undefined, null, [], { isCurrent: true }, { ...options(), extra: true },
    { ...options(), signal: {} }, { ...options(), [Symbol('hidden')]: true },
    Object.create({ isCurrent: () => true }),
    { get isCurrent() { assert.fail('secret-bearing accessor must not execute') } },
    { ...options(), get signal() { assert.fail('signal accessor must not execute') } }]
  for (const value of bad) {
    await assert.rejects(h.authority.configure(binding(), launch(), value), errorCode('invalid'))
    await assert.rejects(h.authority.open(reference, binding(), value), errorCode('invalid'))
  }
  assert.equal(h.reviewed.length + h.provisions.length + h.reads.length + h.opens.length, 0)
  const nullRecord = Object.assign(Object.create(null), options())
  assert.equal(await h.authority.configure(binding(), launch(), nullRecord), reference)
})

test('preflight source checks are synchronous exact-true and recheck cancellation caused by the callback', async t => {
  const h = harness(t)
  for (const isCurrent of [() => false, async () => true, () => Promise.reject(new Error('PRIVATE')), () => { throw new Error('PRIVATE') }]) {
    await assert.rejects(h.authority.configure(binding(), launch(), { isCurrent }), errorCode('stale'))
    await assert.rejects(h.authority.open(reference, binding(), { isCurrent }), errorCode('stale'))
  }
  for (const operation of ['configure', 'open']) {
    const abort = new AbortController()
    const args = operation === 'configure' ? [binding(), launch()] : [reference, binding()]
    await assert.rejects(h.authority[operation](...args, { signal: abort.signal, isCurrent() { abort.abort(); return true } }), errorCode('cancelled'))
  }
  assert.equal(h.reviewed.length + h.provisions.length + h.reads.length + h.opens.length, 0)
})

test('cancel, source change, timeout and host close while native review waits cannot publish a grant', async t => {
  for (const reason of ['cancel', 'stale', 'timeout', 'close']) {
    const answer = deferred(), abort = new AbortController()
    let current = true
    const h = harness(t, { confirmLaunch: () => answer.promise })
    const rejected = assert.rejects(h.authority.configure(binding(), launch(), { signal: abort.signal, isCurrent: () => current }),
      errorCode(reason === 'stale' ? 'stale' : 'cancelled'))
    if (reason === 'cancel') abort.abort()
    if (reason === 'stale') current = false
    if (reason === 'timeout') h.fire()
    if (reason === 'close') h.authority.close()
    if (reason !== 'stale') await rejected // acknowledgement does not wait on an ignored dialog
    answer.resolve(true)
    await rejected
    await turn()
    assert.equal(h.provisions.length, 0)
    assert.equal(h.opens.length, 0)
    assert.equal(h.timers.size, 0)
  }
})

test('ignored cancelled dialogs retain authority capacity until their actual completion', async t => {
  const answers = [], h = harness(t, { confirmLaunch: () => { const value = deferred(); answers.push(value); return value.promise } })
  const aborts = Array.from({ length: LIMITS.pending }, () => new AbortController())
  const rejected = aborts.map(abort => assert.rejects(h.authority.configure(binding(), launch(), { ...options(), signal: abort.signal }), errorCode('cancelled')))
  aborts.forEach(abort => abort.abort())
  await Promise.all(rejected)
  await assert.rejects(h.authority.configure(binding(), launch(), options()), errorCode('capacity'))
  await assert.rejects(h.authority.open(reference, binding(), options()), errorCode('capacity'))
  assert.equal(answers.length, LIMITS.pending)
  answers[0].resolve(true); await turn()
  const admitted = h.authority.configure(binding(), launch(), options())
  assert.equal(answers.length, LIMITS.pending + 1)
  answers.at(-1).resolve(true)
  assert.equal(await admitted, reference)
  for (const answer of answers) answer.resolve(false)
  await turn()
  assert.equal(h.provisions.length, 1)
  assert.equal(h.timers.size, 0)
})

test('after custody submission, cancellation or close retains its durable acknowledgement rather than discarding the reference', async t => {
  for (const reason of ['cancel', 'close', 'stale']) {
    const commit = deferred(), submitted = deferred(), abort = new AbortController()
    let current = true, settled = false
    const h = harness(t, { vault: { provision(...args) { submitted.resolve(args); return commit.promise } } })
    const result = h.authority.configure(binding(), launch(), { signal: abort.signal, isCurrent: () => current })
    void result.then(() => { settled = true }, () => { settled = true })
    const call = await submitted.promise
    assert.deepEqual(call.slice(0, 2), [binding(), launch()])
    assert.equal(h.timers.size, 0, 'native review deadline is retired before custody owns commit')
    if (reason === 'cancel') abort.abort()
    if (reason === 'close') h.authority.close()
    if (reason === 'stale') current = false
    await turn()
    assert.equal(settled, false, 'a submitted durable grant must acknowledge its exact reference')
    commit.resolve(reference)
    assert.equal(await result, reference)
    assert.equal(h.opens.length, 0)
  }
})

test('cancelled custody reads settle promptly but hold capacity until ignored disk work drains', async t => {
  const reads = [], h = harness(t, { vault: { read() { const value = deferred(); reads.push(value); return value.promise } } })
  const aborts = Array.from({ length: LIMITS.pending }, () => new AbortController())
  const rejected = aborts.map(abort => assert.rejects(h.authority.open(reference, binding(), { ...options(), signal: abort.signal }), errorCode('cancelled')))
  aborts.forEach(abort => abort.abort())
  await Promise.all(rejected)
  await assert.rejects(h.authority.open(reference, binding(), options()), errorCode('capacity'))
  await assert.rejects(h.authority.configure(binding(), launch(), options()), errorCode('capacity'))
  assert.equal(reads.length, LIMITS.pending)
  reads[0].resolve(lease()); await turn()
  const admitted = h.authority.open(reference, binding(), options())
  assert.equal(reads.length, LIMITS.pending + 1)
  reads.at(-1).resolve(lease())
  await admitted
  for (const read of reads) read.resolve(lease())
  await turn()
  assert.equal(h.opens.length, 1, 'late reads from cancelled opens never spawn')
  assert.equal(h.timers.size, 0)
})

test('after custody read, stale source, revoked lease, close and deadline prevent process launch', async t => {
  for (const reason of ['stale', 'revoked', 'close', 'timeout', 'missing', 'callback-close']) {
    const read = deferred(), saved = lease()
    let current = true, completedRead = false
    const h = harness(t, { vault: { read: () => read.promise } })
    const rejected = assert.rejects(h.authority.open(reference, binding(), { isCurrent() {
      if (reason === 'callback-close' && completedRead) h.authority.close()
      return current
    } }), errorCode(reason === 'stale' ? 'stale' : reason === 'missing' ? 'unavailable' : 'cancelled'))
    if (reason === 'stale') current = false
    if (reason === 'revoked') saved.controller.abort()
    if (reason === 'close') h.authority.close()
    if (reason === 'timeout') h.fire()
    if (reason === 'close' || reason === 'timeout') await rejected
    completedRead = true
    read.resolve(reason === 'missing' ? null : saved)
    await rejected; await turn()
    assert.equal(h.opens.length, 0)
    assert.equal(h.reviewed.length + h.provisions.length, 0)
    assert.equal(h.timers.size, 0)
  }
})

test('saved lease revocation and authority shutdown close owned processes without rewriting custody or replaying', async t => {
  const h = harness(t)
  await h.authority.open(reference, binding(), options())
  assert.deepEqual(h.reads, [[reference, binding()]])
  assert.equal(h.reviewed.length + h.provisions.length, 0)
  const forwarded = h.opens[0][1]
  assert.equal(forwarded.signal.aborted, false)
  assert.equal(forwarded.isCurrent(), true)
  h.saved.controller.abort()
  assert.equal(forwarded.signal.aborted, true)
  assert.equal(forwarded.isCurrent(), false)
  h.authority.close(); h.authority.close()
  await assert.rejects(h.authority.open(reference, binding(), options()), errorCode('cancelled'))
  await assert.rejects(h.authority.configure(binding(), launch(), options()), errorCode('cancelled'))
  assert.equal(h.opens.length, 1)
})

test('dependency failures expose only fixed native errors, while known safe supervisor failures retain their code', async t => {
  const privateError = new Error('PRIVATE executable /secret/path environment token=not-a-real-token')
  for (const overrides of [
    { confirmLaunch() { throw privateError } },
    { confirmLaunch: async () => { throw privateError } },
    { vault: { provision() { throw privateError } } },
  ]) {
    const h = harness(t, overrides)
    await assert.rejects(h.authority.configure(binding(), launch(), options()), errorCode('unavailable'))
  }
  for (const overrides of [
    { vault: { read() { throw privateError } } },
    { vault: { read: async () => { throw privateError } } },
    { supervisor: { open() { throw privateError } } },
  ]) {
    const h = harness(t, overrides)
    await assert.rejects(h.authority.open(reference, binding(), options()), errorCode('unavailable'))
  }
  const stale = harness(t, { vault: { read: () => ({ ...lease(), isCurrent() { throw privateError } }) } })
  await assert.rejects(stale.authority.open(reference, binding(), options()), errorCode('stale'))
  const h = harness(t, { supervisor: { open() { throw new McpStdioError('busy') } } })
  await assert.rejects(h.authority.open(reference, binding(), options()), error => error instanceof McpStdioError && error.code === 'busy')
})

test('real temporary grant vault composes with an owned repository-authored child; shutdown preserves grants and revocation reaps without replay',
  { skip: process.platform !== 'darwin', timeout: 10_000 }, async t => {
    const directory = await realpath(await mkdtemp(join(tmpdir(), 'ac-stdio-authority-test-')))
    const filePath = join(directory, MCP_STDIO_GRANT_FILE)
    const key = randomBytes(32)
    // Test-only AES custody substitutes for OS storage; this is not Keychain
    // acceptance. The unsandboxed program does not access the filesystem, app,
    // credentials or network; it only reads its pipes and explicit fixture env.
    const storage = {
      isEncryptionAvailable: () => true,
      encryptString(text) {
        const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv)
        const ciphertext = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
        return Buffer.concat([iv, cipher.getAuthTag(), ciphertext])
      },
      decryptString(bytes) {
        const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12))
        decipher.setAuthTag(bytes.subarray(12, 28))
        return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8')
      },
    }
    let spawns = 0
    const supervisor = createMcpStdioSupervisor({ spawnProcess(...args) { spawns += 1; return spawn(...args) } })
    const vault = await openMcpStdioGrantVault({ filePath, storage })
    const authorities = [], connections = []
    t.after(async () => {
      authorities.forEach(authority => authority.close()); supervisor.dispose()
      await Promise.all(connections.map(connection => connection.closed))
      vault.close(); await rm(directory, { recursive: true, force: true })
    })
    const reviewed = []
    const first = createMcpStdioLaunchAuthority({ vault, supervisor, confirmLaunch: async intent => { reviewed.push(intent); return true } })
    authorities.push(first)
    const program = `import readline from 'node:readline';
      readline.createInterface({input:process.stdin}).on('line', line => {
        const row=JSON.parse(line); if(row.id===undefined)return;
        process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:row.id,result:{method:row.method,marker:process.env.MCP_FIXTURE_ONLY}})+'\\n');
      });`
    const approvedLaunch = { executable: process.execPath, args: ['--input-type=module', '-e', program], cwd: directory, env: { MCP_FIXTURE_ONLY: 'reviewed-explicit-fixture' } }
    const ref = await first.configure(binding(), approvedLaunch, options())
    assert.equal(reviewed.length, 1)
    assert.equal(spawns, 0, 'saving custody never starts the program')
    const stored = await readFile(filePath)
    assert.equal(stored.includes(Buffer.from('reviewed-explicit-fixture')), false)
    const connection = await first.open(ref, binding(), options()); connections.push(connection)
    assert.deepEqual((await connection.request('server/discover')).result, { method: 'server/discover', marker: 'reviewed-explicit-fixture' })
    first.close()
    assert.deepEqual(await connection.closed, { code: 'cancelled' })
    assert.deepEqual(await readFile(filePath), stored, 'host shutdown does not rewrite custody')
    assert.ok(await vault.read(ref, binding()), 'shutdown preserves the exact saved grant')
    const second = createMcpStdioLaunchAuthority({ vault, supervisor, confirmLaunch: () => assert.fail('opening a saved grant does not repeat native review') })
    authorities.push(second)
    assert.equal(spawns, 1, 'constructing another host never replays saved launches')
    const next = await second.open(ref, binding(), options()); connections.push(next)
    await next.request('server/discover')
    await vault.discard(ref, binding(), options())
    assert.deepEqual(await next.closed, { code: 'cancelled' })
    assert.equal(await vault.read(ref, binding()), null)
    const revoked = await readFile(filePath)
    second.close(); vault.close()
    assert.deepEqual(await readFile(filePath), revoked)
    assert.equal(spawns, 2, 'only the two explicit open calls started child processes')
  })
