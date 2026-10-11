import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import * as fs from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  MCP_STDIO_GRANT_FILE,
  MCP_STDIO_GRANT_LIMITS,
  McpStdioGrantError,
  openMcpStdioGrantVault,
} from './mcpStdioGrantVault.mjs'

const binding = {
  tenantId: 'tenant-ada',
  ownerUserId: 'user-ada',
  connectionId: `mcp-connection-${'a'.repeat(32)}`,
}
const launch = (label = 'grant-secret') => ({
  executable: '/private/fixture/bin/mcp-peer',
  args: ['--label', label],
  cwd: '/private/fixture/work',
  env: { PRIVATE_MCP_TOKEN: `token-${label}` },
})
const current = { isCurrent: () => true }

const encrypt = (text: string): Buffer => Buffer.from(text, 'utf8').map(byte => byte ^ 0xa5)
const decrypt = (bytes: Buffer): string => Buffer.from(bytes).map(byte => byte ^ 0xa5).toString('utf8')
const secureStorage = () => ({
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: () => 'gnome_libsecret',
  encryptString: encrypt,
  decryptString: decrypt,
})

async function fixture(run: (input: { directory: string; filePath: string; open: (options?: Record<string, unknown>) => Promise<any> }) => Promise<void>,
  extra: Record<string, unknown> = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'agent-commons-stdio-grants-'))
  const filePath = join(directory, MCP_STDIO_GRANT_FILE)
  const open = (options = {}) => openMcpStdioGrantVault({
    filePath,
    storage: secureStorage(),
    platform: 'darwin',
    ...extra,
    ...options,
  })
  try { await run({ directory, filePath, open }) }
  finally { await rm(directory, { recursive: true, force: true }) }
}

function errorCode(code: string) {
  return (error: unknown) => error instanceof McpStdioGrantError && error.code === code
}

function gate() {
  let release!: () => void
  let entered!: () => void
  const reached = new Promise<void>(resolve => { entered = resolve })
  const blocked = new Promise<void>(resolve => { release = resolve })
  return { reached, release, wait: async () => { entered(); await blocked } }
}

function fsWithFileSyncGate(filePath: string, blocker: ReturnType<typeof gate>, once = true) {
  let held = false
  return {
    async lstat(path: fs.PathLike, ...args: any[]) { return fs.lstat(path, ...args as [any]) },
    async rename(from: fs.PathLike, to: fs.PathLike) { return fs.rename(from, to) },
    async unlink(path: fs.PathLike) { return fs.unlink(path) },
    async open(path: fs.PathLike, ...args: any[]) {
      const handle = await fs.open(path, ...args as [any])
      const hold = String(path).startsWith(`${filePath}.`) && (!once || !held)
      if (hold) held = true
      return new Proxy(handle, {
        get(target, property) {
          const value = Reflect.get(target, property, target)
          if (property === 'sync' && hold) return async () => { await blocker.wait(); return target.sync() }
          return typeof value === 'function' ? value.bind(target) : value
        },
      })
    },
  }
}

function fsWithControllableFileSync(filePath: string) {
  let nextGate: ReturnType<typeof gate> | undefined
  return {
    api: {
      async lstat(path: fs.PathLike, ...args: any[]) { return fs.lstat(path, ...args as [any]) },
      async rename(from: fs.PathLike, to: fs.PathLike) { return fs.rename(from, to) },
      async unlink(path: fs.PathLike) { return fs.unlink(path) },
      async open(path: fs.PathLike, ...args: any[]) {
        const handle = await fs.open(path, ...args as [any])
        return new Proxy(handle, { get(target, property) {
          const value = Reflect.get(target, property, target)
          if (property === 'sync' && String(path).startsWith(`${filePath}.`)) return async () => {
            const held = nextGate
            nextGate = undefined
            if (held) await held.wait()
            return target.sync()
          }
          return typeof value === 'function' ? value.bind(target) : value
        } })
      },
    },
    hold(blocker: ReturnType<typeof gate>) { nextGate = blocker },
  }
}

function fsWithToggleDirectorySyncFailure(directory: string) {
  let shouldFail = false
  return {
    api: {
      async lstat(path: fs.PathLike, ...args: any[]) { return fs.lstat(path, ...args as [any]) },
      async rename(from: fs.PathLike, to: fs.PathLike) { return fs.rename(from, to) },
      async unlink(path: fs.PathLike) { return fs.unlink(path) },
      async open(path: fs.PathLike, ...args: any[]) {
        const handle = await fs.open(path, ...args as [any])
        return new Proxy(handle, { get(target, property) {
          const value = Reflect.get(target, property, target)
          if (property === 'sync' && String(path) === directory) return async () => {
            if (shouldFail) throw new Error('fixture directory fsync failure')
            return target.sync()
          }
          return typeof value === 'function' ? value.bind(target) : value
        } })
      },
    },
    failNext() { shouldFail = true },
  }
}

test('grants are encrypted, secret-free on disk, immutable, and recover after reopening', async () => {
  await fixture(async ({ filePath, open }) => {
    const vault = await open()
    const intent = launch('private-needle')
    const reference = await vault.provision(binding, intent, current)
    assert.match(reference, /^MCP_STDIO_[A-F0-9]{32}$/)
    const disk = await readFile(filePath, 'utf8')
    for (const secret of [binding.tenantId, binding.ownerUserId, binding.connectionId,
      intent.executable, intent.cwd, intent.args[1]!, intent.env.PRIVATE_MCP_TOKEN]) {
      assert.equal(disk.includes(secret), false, `plaintext disk does not contain ${secret}`)
    }
    assert.deepEqual(Object.keys(JSON.parse(disk)).sort(), ['ciphertext', 'version'])

    const reopened = await open()
    const lease = await reopened.read(reference, binding)
    assert.deepEqual(lease?.launch, intent)
    assert.ok(Object.isFrozen(lease))
    assert.ok(Object.isFrozen(lease?.launch))
    assert.ok(Object.isFrozen(lease?.launch.args))
    assert.ok(Object.isFrozen(lease?.launch.env))
    assert.equal(lease?.isCurrent(), true)
  })
})

test('opaque references are bound to the exact person, tenant, and connection', async () => {
  await fixture(async ({ open, filePath }) => {
    const vault = await open()
    const reference = await vault.provision(binding, launch(), current)
    const before = await readFile(filePath)
    for (const foreign of [
      { ...binding, tenantId: 'tenant-other' },
      { ...binding, ownerUserId: 'user-other' },
      { ...binding, connectionId: `mcp-connection-${'b'.repeat(32)}` },
    ]) assert.equal(await vault.read(reference, foreign), null)
    assert.equal(await vault.read(reference, binding) !== null, true)
    assert.deepEqual(await readFile(filePath), before, 'foreign reads are inert')
  })
})

test('the whole launch and binding intent are detached before waiting behind the disk queue', async () => {
  await fixture(async ({ filePath, open }) => {
    const blocker = gate()
    const vault = await open({ fsApi: fsWithFileSyncGate(filePath, blocker) })
    const first = vault.provision({ ...binding, connectionId: `mcp-connection-${'c'.repeat(32)}` }, launch('first'), current)
    await blocker.reached

    const rawBinding = { ...binding, connectionId: `mcp-connection-${'d'.repeat(32)}` }
    const rawLaunch = launch('snapshotted')
    const second = vault.provision(rawBinding, rawLaunch, current)
    rawBinding.tenantId = 'tenant-mutated'
    rawBinding.ownerUserId = 'user-mutated'
    rawLaunch.executable = '/changed/after/call'
    rawLaunch.args[1] = 'mutated'
    rawLaunch.env.PRIVATE_MCP_TOKEN = 'mutated-secret'

    blocker.release()
    const [firstRef, secondRef] = await Promise.all([first, second])
    assert.deepEqual((await vault.read(secondRef, { ...binding, connectionId: `mcp-connection-${'d'.repeat(32)}` }))?.launch,
      launch('snapshotted'))
    assert.equal(await vault.read(secondRef, rawBinding), null)
    assert.match(firstRef, /^MCP_STDIO_/)
  })
})

test('reads wait behind an unsettled durable mutation and observe the committed snapshot only', async () => {
  await fixture(async ({ filePath, open }) => {
    const fsApi = fsWithControllableFileSync(filePath)
    const vault = await open({ fsApi: fsApi.api })
    const existing = await vault.provision(binding, launch('existing'), current)
    const blocker = gate()
    fsApi.hold(blocker)
    const nextBinding = { ...binding, connectionId: `mcp-connection-${'7'.repeat(32)}` }
    const mutation = vault.provision(nextBinding, launch('new'), current)
    await blocker.reached
    let readFinished = false
    const pendingRead = vault.read(existing, binding).then(value => { readFinished = true; return value })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(readFinished, false, 'read cannot pass the serialized write/fsync queue')
    blocker.release()
    await mutation
    assert.deepEqual((await pendingRead)?.launch, launch('existing'))
    assert.equal(readFinished, true)
  })
})

test('entry and serialized-size bounds refuse without dropping prior grants', async () => {
  await fixture(async ({ open }) => {
    const vault = await open()
    const references: string[] = []
    for (let index = 0; index < MCP_STDIO_GRANT_LIMITS.entries; index += 1) {
      references.push(await vault.provision({ ...binding, connectionId: `mcp-connection-${index.toString(16).padStart(32, '0')}` }, launch(`entry-${index}`), current))
    }
    await assert.rejects(vault.provision({ ...binding, connectionId: `mcp-connection-${'f'.repeat(32)}` }, launch('overflow'), current), errorCode('capacity'))
    assert.ok(await vault.read(references[0]!, { ...binding, connectionId: `mcp-connection-${'0'.repeat(32)}` }))
  })

  await fixture(async ({ open }) => {
    const vault = await open()
    const longLaunch = () => ({ ...launch('large'), args: Array.from({ length: 7 }, () => 'x'.repeat(8_192)) })
    let refused = false
    for (let index = 0; index < 24; index += 1) {
      try {
        await vault.provision({ ...binding, connectionId: `mcp-connection-${(index + 100).toString(16).padStart(32, '0')}` }, longLaunch(), current)
      } catch (error) {
        assert.ok(errorCode('capacity')(error))
        refused = true
        break
      }
    }
    assert.equal(refused, true, 'aggregate private plaintext budget eventually refuses a valid-sized grant')
  })

  await fixture(async ({ open }) => {
    const vault = await open()
    let getterCalls = 0
    const launchWithGetter = { ...launch() }
    Object.defineProperty(launchWithGetter, 'env', { enumerable: true, get() { getterCalls += 1; return {} } })
    await assert.rejects(vault.provision(binding, launchWithGetter, current), errorCode('invalid'))
    const optionsWithGetter = Object.defineProperty({}, 'isCurrent', { enumerable: true, get() { getterCalls += 1; return () => true } })
    await assert.rejects(vault.provision(binding, launch(), optionsWithGetter), errorCode('invalid'))
    assert.equal(getterCalls, 0, 'input accessors are refused without invoking them')
  })

  await fixture(async ({ open }) => {
    let plaintext = ''
    const oversizedCipherStorage = {
      isEncryptionAvailable: () => true,
      encryptString(value: string) { plaintext = value; return Buffer.alloc(MCP_STDIO_GRANT_LIMITS.fileBytes + 1, 0x5a) },
      decryptString() { return plaintext },
    }
    const vault = await open({ storage: oversizedCipherStorage })
    await assert.rejects(vault.provision(binding, launch('oversized-cipher'), current), errorCode('unavailable'))
  })
})

test('unsupported secure storage and unsafe or corrupt files fail closed without repair', async () => {
  await fixture(async ({ filePath, open }) => {
    for (const platform of ['win32', 'linux']) {
      await assert.rejects(open({ platform }), errorCode('unavailable'), 'local MCP custody is macOS-only even with secure storage')
    }
    await assert.rejects(open({ platform: 'linux', storage: {
      ...secureStorage(), getSelectedStorageBackend: () => 'basic_text',
    } }), errorCode('unavailable'))
    await assert.rejects(open({ storage: { ...secureStorage(), isEncryptionAvailable: () => false } }), errorCode('unavailable'))
    assert.equal(await fs.stat(dirname(filePath)).then(stat => stat.mode & 0o777), 0o700)
  })

  await fixture(async ({ filePath, open }) => {
    const vault = await open()
    await vault.provision(binding, launch(), current)
    const before = await readFile(filePath)
    await chmod(filePath, 0o644)
    const unsafe = await readFile(filePath)
    await assert.rejects(open(), errorCode('unavailable'))
    assert.deepEqual(await readFile(filePath), unsafe)
    assert.equal((await fs.stat(filePath)).mode & 0o777, 0o644)
    assert.deepEqual(unsafe, before, 'refusal does not rewrite or repair the unsafe file')
  })

  await fixture(async ({ filePath, open }) => {
    await fs.mkdir(dirname(filePath), { mode: 0o700, recursive: true })
    for (const malformed of [
      JSON.stringify({ version: 2, ciphertext: encrypt(JSON.stringify({ version: 1, entries: [] })).toString('base64') }),
      JSON.stringify({ version: 1, ciphertext: Buffer.from('not-canonical-base64?').toString('base64') }),
      JSON.stringify({ version: 1, ciphertext: encrypt('not JSON').toString('base64'), unexpected: true }),
    ]) {
      await writeFile(filePath, malformed, { mode: 0o600 })
      const before = await readFile(filePath)
      await assert.rejects(open(), errorCode('unavailable'))
      assert.deepEqual(await readFile(filePath), before)
    }
  })
})

test('source changes and cancellation are rechecked after queued temporary-file fsync', async () => {
  for (const mode of ['source', 'cancel'] as const) {
    await fixture(async ({ filePath, open }) => {
      const blocker = gate()
      const vault = await open({ fsApi: fsWithFileSyncGate(filePath, blocker) })
      const controller = new AbortController()
      let isCurrent = true
      const pending = vault.provision(binding, launch(mode), {
        signal: controller.signal,
        isCurrent: () => isCurrent,
      })
      await blocker.reached
      if (mode === 'source') isCurrent = false
      else controller.abort()
      blocker.release()
      await assert.rejects(pending, errorCode(mode === 'source' ? 'stale' : 'cancelled'))
      assert.equal(await readFile(filePath).then(() => true, () => false), false, 'refused provisional grant is not published')
    })
  }
})

test('serialized writes retain one disk queue after a cancelled waiter and close fences queued work', async () => {
  await fixture(async ({ filePath, open }) => {
    const blocker = gate()
    const vault = await open({ fsApi: fsWithFileSyncGate(filePath, blocker) })
    const first = vault.provision({ ...binding, connectionId: `mcp-connection-${'1'.repeat(32)}` }, launch('first'), current)
    await blocker.reached
    const cancelled = new AbortController()
    const second = vault.provision({ ...binding, connectionId: `mcp-connection-${'2'.repeat(32)}` }, launch('cancelled'), {
      signal: cancelled.signal, isCurrent: () => true,
    })
    const third = vault.provision({ ...binding, connectionId: `mcp-connection-${'3'.repeat(32)}` }, launch('closed'), current)
    const queued = Array.from({ length: MCP_STDIO_GRANT_LIMITS.pending - 3 }, (_, index) =>
      vault.provision({ ...binding, connectionId: `mcp-connection-${(index + 10).toString(16).padStart(32, '0')}` }, launch(`queued-${index}`), current))
    const overflow = vault.provision({ ...binding, connectionId: `mcp-connection-${'9'.repeat(32)}` }, launch('queue-overflow'), current)
    await assert.rejects(overflow, errorCode('capacity'))
    cancelled.abort()
    vault.close()
    blocker.release()
    await assert.rejects(first, errorCode('cancelled'))
    await assert.rejects(second, errorCode('cancelled'))
    await assert.rejects(third, errorCode('cancelled'))
    await Promise.all(queued.map(pending => assert.rejects(pending, errorCode('cancelled'))))
    assert.equal(vault.unavailable, true)
    assert.equal(await readFile(filePath).then(() => true, () => false), false)
  })
})

test('discard revokes active leases, while missing and foreign references are harmless no-ops', async () => {
  await fixture(async ({ open, filePath }) => {
    const vault = await open()
    const reference = await vault.provision(binding, launch(), current)
    const lease = await vault.read(reference, binding)
    const before = await readFile(filePath)
    assert.equal(await vault.discard(reference, { ...binding, tenantId: 'tenant-foreign' }, current), undefined)
    assert.equal(await vault.discard(`MCP_STDIO_${'0'.repeat(32)}`, binding, current), undefined)
    assert.deepEqual(await readFile(filePath), before)
    assert.equal(lease?.isCurrent(), true)

    await vault.discard(reference, binding, current)
    assert.equal(lease?.signal.aborted, true)
    assert.equal(lease?.isCurrent(), false)
    assert.equal(await vault.read(reference, binding), null)

    const second = await vault.provision({ ...binding, connectionId: `mcp-connection-${'6'.repeat(32)}` }, launch('close'), current)
    const closeLease = await vault.read(second, { ...binding, connectionId: `mcp-connection-${'6'.repeat(32)}` })
    vault.close()
    assert.equal(closeLease?.signal.aborted, true)
    assert.equal(closeLease?.isCurrent(), false)
  })
})

test('external compare-and-swap changes poison the vault rather than being overwritten', async () => {
  await fixture(async ({ filePath, open }) => {
    const vault = await open()
    const reference = await vault.provision(binding, launch('before'), current)
    const external = JSON.stringify({ version: 1, ciphertext: encrypt(JSON.stringify({ version: 1, entries: [] })).toString('base64') })
    await writeFile(filePath, external, { mode: 0o600 })
    const changed = await readFile(filePath)
    await assert.rejects(vault.provision({ ...binding, connectionId: `mcp-connection-${'4'.repeat(32)}` }, launch('overwrite'), current), errorCode('unavailable'))
    assert.deepEqual(await readFile(filePath), changed)
    assert.equal(vault.unavailable, true)
    await assert.rejects(vault.read(reference, binding), errorCode('unavailable'))
  })
})

test('cancellation during post-rename directory fsync still returns the durable exact reference', async () => {
  await fixture(async ({ filePath, open }) => {
    const blocker = gate()
    const fsApi = {
      async lstat(path: fs.PathLike, ...args: any[]) { return fs.lstat(path, ...args as [any]) },
      async rename(from: fs.PathLike, to: fs.PathLike) { return fs.rename(from, to) },
      async unlink(path: fs.PathLike) { return fs.unlink(path) },
      async open(path: fs.PathLike, ...args: any[]) {
        const handle = await fs.open(path, ...args as [any])
        if (String(path) !== dirname(filePath)) return handle
        return new Proxy(handle, { get(target, property) {
          const value = Reflect.get(target, property, target)
          if (property === 'sync') return async () => { await blocker.wait(); return target.sync() }
          return typeof value === 'function' ? value.bind(target) : value
        } })
      },
    }
    const vault = await open({ fsApi })
    const controller = new AbortController()
    const pending = vault.provision(binding, launch('durable-after-cancel'), {
      signal: controller.signal, isCurrent: () => true,
    })
    await blocker.reached
    controller.abort()
    blocker.release()
    const reference = await pending
    assert.match(reference, /^MCP_STDIO_[A-F0-9]{32}$/)
    assert.deepEqual((await vault.read(reference, binding))?.launch, launch('durable-after-cancel'))
  })
})

test('uncertain directory-fsync failure retains published bytes but invalidates existing leases', async () => {
  await fixture(async ({ filePath, open }) => {
    const fs = fsWithToggleDirectorySyncFailure(dirname(filePath))
    const vault = await open({ fsApi: fs.api })
    const existing = await vault.provision(binding, launch('existing'), current)
    const lease = await vault.read(existing, binding)
    const before = await readFile(filePath)
    fs.failNext()
    await assert.rejects(vault.provision({ ...binding, connectionId: `mcp-connection-${'5'.repeat(32)}` }, launch('uncertain'), current), errorCode('unavailable'))
    assert.notDeepEqual(await readFile(filePath), before)
    assert.equal(vault.unavailable, true)
    assert.equal(lease?.signal.aborted, true)
    assert.equal(lease?.isCurrent(), false)
    const disk = JSON.parse(await readFile(filePath, 'utf8'))
    const payload = JSON.parse(decrypt(Buffer.from(disk.ciphertext, 'base64')))
    const uncertainReference = payload.entries.find((entry: { binding: { connectionId: string } }) => entry.binding.connectionId.endsWith('5'.repeat(32))).reference
    const reopened = await open()
    assert.deepEqual((await reopened.read(existing, binding))?.launch, launch('existing'))
    assert.deepEqual((await reopened.read(uncertainReference, { ...binding, connectionId: `mcp-connection-${'5'.repeat(32)}` }))?.launch,
      launch('uncertain'), 'a future recovery can identify the uncertain durable grant without rewriting it')
  })
})

test('authoritative reconciliation revokes orphan leases before disk cleanup and preserves only exact requested custody', async () => {
  await fixture(async ({ filePath, open }) => {
    const vault = await open()
    const kept = await vault.provision(binding, launch('kept'), current)
    const orphan = await vault.provision(binding, launch('orphan'), current)
    const keptLease = await vault.read(kept, binding), orphanLease = await vault.read(orphan, binding)
    const reconciling = vault.reconcile([{ reference: kept, binding }], current)
    assert.equal(orphanLease.signal.aborted, true, 'revocation precedes the queued persistence acknowledgement')
    assert.equal(orphanLease.isCurrent(), false)
    assert.equal(keptLease.signal.aborted, false)
    assert.equal(await reconciling, true)
    assert.equal(await vault.read(orphan, binding), null)
    const before = await readFile(filePath)
    assert.equal(await vault.reconcile([{ reference: kept, binding }], current), true)
    assert.deepEqual(await readFile(filePath), before, 'matching reconciliation performs no rewrite')
    vault.close()
    const reopened = await open()
    assert.deepEqual((await reopened.read(kept, binding)).launch, launch('kept'))
    assert.equal(await reopened.read(orphan, binding), null)
    reopened.close()
  })
})

test('failed cleanup cannot revive retired leases and reconciliation retries without repairing or exposing failures', async () => {
  await fixture(async ({ filePath, open }) => {
    let failEncryption = false
    const storage = { ...secureStorage(), encryptString(text) {
      if (failEncryption) throw new Error('PRIVATE reconciliation key diagnostics')
      return encrypt(text)
    } }
    const vault = await open({ storage })
    const kept = await vault.provision(binding, launch('kept'), current)
    const orphan = await vault.provision(binding, launch('orphan'), current)
    const orphanLease = await vault.read(orphan, binding), before = await readFile(filePath)
    failEncryption = true
    await assert.rejects(vault.reconcile([{ reference: kept, binding }], current), errorCode('unavailable'))
    assert.equal(orphanLease.signal.aborted, true)
    assert.deepEqual(await readFile(filePath), before)
    assert.equal(await vault.reconcile([{ reference: kept, binding }, { reference: orphan, binding }], current), false,
      'an aborted orphan cannot become usable through a stale keep-list')
    failEncryption = false
    assert.equal(await vault.reconcile([{ reference: kept, binding }], current), true)
    assert.equal(await vault.read(orphan, binding), null)
    assert.equal(await vault.reconcile([{ reference: `MCP_STDIO_${'0'.repeat(32)}`, binding }], current), false,
      'missing saved custody is not a usable authoritative binding')
    vault.close()
  })
})

test('reconciliation validates the whole exact keep-list before revoking or writing anything', async () => {
  await fixture(async ({ filePath, open }) => {
    const vault = await open(), reference = await vault.provision(binding, launch(), current)
    const lease = await vault.read(reference, binding), before = await readFile(filePath)
    for (const rows of [undefined, {}, Array(1), [{ reference, binding }, { reference, binding }],
      [{ reference, binding, extra: true }], [{ reference, binding: { ...binding, connectionRevision: 0 } }],
      [{ get reference() { assert.fail('accessor must not execute') }, binding }]]) {
      await assert.rejects(vault.reconcile(rows, current), errorCode('invalid'))
    }
    assert.equal(lease.signal.aborted, false)
    assert.equal(lease.isCurrent(), true)
    assert.deepEqual(await readFile(filePath), before)
    vault.close()
  })
})
