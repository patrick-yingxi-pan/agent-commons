import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  configureMcpRuntime,
  initializeMcpRuntime,
  mcpRuntimeCapabilities,
  mcpRuntimeConfiguration,
  synchronizeMcpCredentials,
} from './mcpRuntime.ts'

const binding = {
  reference: `MCP_DESKTOP_${'A'.repeat(32)}`,
  binding: { tenantId: 'tenant-alpha', connectionId: 'mcp-connection-a', endpoint: 'https://mcp.example/tools' },
}

beforeEach(() => {
  configureMcpRuntime({ deviceBearerAvailable: false, allowLoopback: false })
})

test('startup waits for the rehydrated binding acknowledgement before earning device capability', async () => {
  let acknowledge!: (result: { available: boolean }) => void
  let received: unknown
  configureMcpRuntime({ deviceBearerAvailable: false, allowLoopback: false,
    resolveCredential: async () => 'unused',
    synchronizeBindings: async bindings => {
      received = bindings
      return new Promise(resolve => { acknowledge = resolve })
    },
  })
  let ready = false
  const startup = initializeMcpRuntime([binding]).then(() => { ready = true })
  await Promise.resolve()
  assert.deepEqual(received, [binding])
  assert.equal(ready, false)
  assert.equal(mcpRuntimeCapabilities().deviceBearerCredentials, false)
  acknowledge({ available: true })
  await startup
  assert.equal(ready, true)
  assert.equal(mcpRuntimeCapabilities().deviceBearerCredentials, true)
})

test('failed or superseded startup cannot admit the server with unacknowledged bindings', async () => {
  configureMcpRuntime({ deviceBearerAvailable: false, allowLoopback: false,
    synchronizeBindings: async () => { throw new Error('IPC refused') },
  })
  await assert.rejects(initializeMcpRuntime([binding]), /IPC refused/)
  assert.equal(mcpRuntimeCapabilities().deviceBearerCredentials, false)
  let acknowledge!: (result: { available: boolean }) => void
  configureMcpRuntime({ deviceBearerAvailable: false, allowLoopback: false,
    synchronizeBindings: async () => new Promise(resolve => { acknowledge = resolve }),
  })
  const startup = initializeMcpRuntime([binding])
  configureMcpRuntime({ deviceBearerAvailable: false, allowLoopback: false })
  acknowledge({ available: true })
  await assert.rejects(startup, /current deployment/)
  assert.equal(mcpRuntimeCapabilities().deviceBearerCredentials, false)
})

test('default and explicitly configured public runtime expose no device authority', () => {
  assert.deepEqual(mcpRuntimeCapabilities(), {
    deviceBearerCredentials: false, loopbackConnections: false, credentialCleanupPending: false,
  })
  configureMcpRuntime({ deviceBearerAvailable: false, allowLoopback: true })
  assert.deepEqual(mcpRuntimeCapabilities(), {
    deviceBearerCredentials: false, loopbackConnections: true, credentialCleanupPending: false,
  })
  assert.equal(mcpRuntimeConfiguration().resolveCredential, undefined)
})

test('device configuration requires both resolver and synchronizer, and does not expose raw credentials', () => {
  assert.throws(() => configureMcpRuntime({ deviceBearerAvailable: true, allowLoopback: false }), /configuration is invalid/)
  const rawSecret = 'raw-bearer-must-never-cross-runtime-state'
  configureMcpRuntime({
    deviceBearerAvailable: true,
    allowLoopback: false,
    resolveCredential: async () => rawSecret,
    synchronizeBindings: async () => ({ available: true }),
  })
  assert.doesNotMatch(JSON.stringify(mcpRuntimeConfiguration()), new RegExp(rawSecret))
  assert.doesNotMatch(JSON.stringify(mcpRuntimeCapabilities()), new RegExp(rawSecret))
})

test('effective runtime snapshots keep stable identity before and after partial capability synchronization', async () => {
  configureMcpRuntime({ deviceBearerAvailable: true, deviceOAuthAvailable: true, allowLoopback: false,
    localProcessesAvailable: true, resolveCredential: async () => 'unused', resolveOAuthCredential: async () => 'unused',
    openStdio: () => { throw new Error('not called') },
    synchronizeBindings: async () => ({ available: false }), synchronizeStdioBindings: async () => ({ available: true }) })
  const before = mcpRuntimeConfiguration()
  assert.strictEqual(mcpRuntimeConfiguration(), before, 'unavailable HTTP/OAuth capabilities must not churn the inspector cache')
  await initializeMcpRuntime([], [])
  const partial = mcpRuntimeConfiguration()
  assert.equal(partial.localProcessesAvailable, true)
  assert.equal(partial.deviceOAuthAvailable, false)
  assert.strictEqual(mcpRuntimeConfiguration(), partial, 'a stable partial runtime also retains identity')
})

test('successful synchronization clears pending cleanup, while unavailable storage and failures stay pending', async () => {
  let available = false
  let seen: unknown
  configureMcpRuntime({
    deviceBearerAvailable: true,
    allowLoopback: false,
    resolveCredential: async () => 'not-observed-by-runtime',
    synchronizeBindings: async (bindings) => { seen = bindings; return { available } },
  })
  assert.equal(await synchronizeMcpCredentials([binding]), 'pending')
  assert.deepEqual(seen, [binding], 'the synchronizer receives only opaque bindings')
  available = true
  assert.equal(await synchronizeMcpCredentials([binding]), 'complete')
  assert.equal(mcpRuntimeCapabilities().credentialCleanupPending, false)

  configureMcpRuntime({
    deviceBearerAvailable: true,
    allowLoopback: false,
    resolveCredential: async () => 'unused',
    synchronizeBindings: async () => { throw new Error('storage unavailable') },
  })
  assert.equal(await synchronizeMcpCredentials([binding]), 'pending')
  assert.equal(mcpRuntimeCapabilities().credentialCleanupPending, true)
  configureMcpRuntime({
    deviceBearerAvailable: true,
    allowLoopback: false,
    resolveCredential: async () => 'unused',
    synchronizeBindings: async () => ({ available: true }),
  })
  assert.equal(await synchronizeMcpCredentials([]), 'complete')
  assert.equal(mcpRuntimeCapabilities().credentialCleanupPending, false)
})

test('stdio synchronization failure revokes local-process capability and a later acknowledgement can recover it', async () => {
  let available = false
  let fail = false
  const options = {
    deviceBearerAvailable: false,
    localProcessesAvailable: true,
    allowLoopback: false,
    openStdio: () => { throw new Error('not called') },
    synchronizeStdioBindings: async () => {
      if (fail) throw new Error('native lifecycle unavailable')
      return { available }
    },
  }
  configureMcpRuntime(options)
  await initializeMcpRuntime([], [])
  assert.equal(mcpRuntimeCapabilities().localProcesses, undefined)
  assert.equal(mcpRuntimeConfiguration().localProcessesAvailable, false)

  available = true
  assert.equal(await synchronizeMcpCredentials([], []), 'complete')
  assert.equal(mcpRuntimeCapabilities().localProcesses, true)
  assert.equal(mcpRuntimeConfiguration().localProcessesAvailable, true)

  available = false
  assert.equal(await synchronizeMcpCredentials([], []), 'pending')
  assert.equal(mcpRuntimeCapabilities().localProcesses, undefined)
  assert.equal(mcpRuntimeConfiguration().localProcessesAvailable, false)

  fail = true
  assert.equal(await synchronizeMcpCredentials([], []), 'pending')
  assert.equal(mcpRuntimeCapabilities().localProcesses, undefined)
  assert.equal(mcpRuntimeConfiguration().localProcessesAvailable, false)

  // A new successful boot acknowledgement must use the originally requested
  // native capability, not the last effective `false` snapshot.
  fail = false
  available = true
  await initializeMcpRuntime([], [])
  assert.equal(mcpRuntimeCapabilities().localProcesses, true)
  assert.equal(mcpRuntimeConfiguration().localProcessesAvailable, true)
})

test('a malformed native availability acknowledgement fails closed', async () => {
  configureMcpRuntime({ deviceBearerAvailable: false, localProcessesAvailable: true, allowLoopback: false,
    openStdio: () => { throw new Error('not called') },
    synchronizeStdioBindings: async () => ({ available: 'yes' as unknown as boolean }) })
  assert.equal(await synchronizeMcpCredentials([], []), 'pending')
  assert.equal(mcpRuntimeCapabilities().localProcesses, undefined)
  assert.equal(mcpRuntimeCapabilities().credentialCleanupPending, true)
})

test('an old held synchronization cannot overwrite cleanup state after configuration changes', async () => {
  let releaseOld!: (result: { available: boolean }) => void
  configureMcpRuntime({
    deviceBearerAvailable: true,
    allowLoopback: false,
    resolveCredential: async () => 'old-unused',
    synchronizeBindings: async () => new Promise<{ available: boolean }>((resolve) => { releaseOld = resolve }),
  })
  const old = synchronizeMcpCredentials([binding])
  configureMcpRuntime({
    deviceBearerAvailable: true,
    allowLoopback: false,
    resolveCredential: async () => 'new-unused',
    synchronizeBindings: async () => ({ available: true }),
  })
  assert.equal(await synchronizeMcpCredentials([]), 'complete')
  releaseOld({ available: false })
  assert.equal(await old, 'pending')
  assert.equal(mcpRuntimeCapabilities().credentialCleanupPending, false)
})
