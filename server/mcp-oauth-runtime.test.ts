import assert from 'node:assert/strict'
import test from 'node:test'
import { configureMcpRuntime, initializeMcpRuntime, mcpRuntimeCapabilities, mcpRuntimeConfiguration } from './mcpRuntime.ts'

const resolver = async () => 'access-token'
const sync = async () => ({ available: true })

test('OAuth device capability is additive and absent when unavailable', () => {
  configureMcpRuntime({ deviceBearerAvailable: false, allowLoopback: false })
  assert.deepEqual(mcpRuntimeCapabilities(), {
    deviceBearerCredentials: false, loopbackConnections: false, credentialCleanupPending: false,
  })
  configureMcpRuntime({ deviceBearerAvailable: false, allowLoopback: false, resolveOAuthCredential: resolver,
    synchronizeBindings: sync })
  assert.equal(Object.hasOwn(mcpRuntimeCapabilities(), 'deviceOAuthCredentials'), false)
})

test('OAuth device capability requires a resolver and synchronization and is earned only after startup acknowledgment', async () => {
  assert.throws(() => configureMcpRuntime({ deviceBearerAvailable: false, deviceOAuthAvailable: true, allowLoopback: false }),
    /configuration is invalid/)
  assert.throws(() => configureMcpRuntime({ deviceBearerAvailable: false, deviceOAuthAvailable: true, allowLoopback: false,
    resolveOAuthCredential: resolver }), /configuration is invalid/)

  let acknowledge!: (result: { available: boolean }) => void
  configureMcpRuntime({ deviceBearerAvailable: false, deviceOAuthAvailable: true, allowLoopback: false,
    resolveOAuthCredential: resolver, synchronizeBindings: async () => new Promise(resolve => { acknowledge = resolve }) })
  const startup = initializeMcpRuntime([])
  await Promise.resolve()
  assert.equal(Object.hasOwn(mcpRuntimeCapabilities(), 'deviceOAuthCredentials'), false)
  assert.equal(mcpRuntimeConfiguration().deviceOAuthAvailable, false)
  acknowledge({ available: true })
  await startup
  assert.equal(mcpRuntimeCapabilities().deviceOAuthCredentials, true)
  assert.equal(mcpRuntimeConfiguration().deviceOAuthAvailable, true)

  configureMcpRuntime({ deviceBearerAvailable: false, deviceOAuthAvailable: true, allowLoopback: false,
    resolveOAuthCredential: resolver, synchronizeBindings: async () => ({ available: false }) })
  await initializeMcpRuntime([])
  assert.equal(Object.hasOwn(mcpRuntimeCapabilities(), 'deviceOAuthCredentials'), false)
  assert.equal(mcpRuntimeCapabilities().credentialCleanupPending, true)
})
