import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import {
  CREDENTIAL_BINDINGS,
  CREDENTIAL_REQUEST,
  CREDENTIAL_RESULT,
  createCredentialBackendClient,
  installCredentialRuntime,
} from './credentialProtocol.mjs'

class FakeParentPort extends EventEmitter {
  sent: unknown[] = []
  postMessage(message: unknown) { this.sent.push(message) }
}

class FakeChild extends EventEmitter {
  posted: any[] = []
  postMessage(message: any) { this.posted.push(message) }
}

test('the utility runtime mutates only generated provider variables and never echoes a secret', () => {
  const port = new FakeParentPort()
  const env: Record<string, string | undefined> = { AUTH_SECRET: 'do-not-touch' }
  installCredentialRuntime(port as any, env)
  const reference = `PROVIDER_DESKTOP_${'A'.repeat(32)}`
  port.emit('message', { data: { type: CREDENTIAL_REQUEST, requestId: 1, operation: 'set', reference, secret: 'device-secret' } })
  assert.equal(env[reference], 'device-secret')
  assert.deepEqual(port.sent.at(-1), { type: CREDENTIAL_RESULT, requestId: 1, ok: true })
  assert.equal(JSON.stringify(port.sent).includes('device-secret'), false)

  port.emit('message', { data: { type: CREDENTIAL_REQUEST, requestId: 2, operation: 'set', reference: 'AUTH_SECRET', secret: 'stolen' } })
  assert.equal(env.AUTH_SECRET, 'do-not-touch')
  assert.deepEqual(port.sent.at(-1), { type: CREDENTIAL_RESULT, requestId: 2, ok: false, error: 'invalid_reference' })

  port.emit('message', { data: { type: CREDENTIAL_REQUEST, requestId: 3, operation: 'delete', reference } })
  assert.equal(env[reference], undefined)
})

test('binding announcements are structurally filtered before leaving the backend', () => {
  const port = new FakeParentPort()
  const runtime = installCredentialRuntime(port as any, {})!
  runtime.announceBindings([
    { reference: `PROVIDER_DESKTOP_${'B'.repeat(32)}`, providerId: 'provider-8' },
    { reference: 'PROVIDER_SHARED', providerId: 'provider-9' },
    { reference: `PROVIDER_DESKTOP_${'C'.repeat(32)}`, providerId: '../bad' },
  ])
  assert.deepEqual(port.sent, [{
    type: CREDENTIAL_BINDINGS,
    bindings: [{ reference: `PROVIDER_DESKTOP_${'B'.repeat(32)}`, providerId: 'provider-8' }],
  }])
})

test('the main client correlates acknowledgements, bindings, timeouts, and close without exposing secrets', async () => {
  const child = new FakeChild()
  const bindings: unknown[] = []
  const client = createCredentialBackendClient(child as any, { onBindings: (value) => bindings.push(value), timeoutMs: 20 })
  const reference = `PROVIDER_DESKTOP_${'D'.repeat(32)}`

  const setting = client.set(reference, 'short-lived-secret')
  const request = child.posted.at(-1)
  assert.equal(request.operation, 'set')
  child.emit('message', { type: CREDENTIAL_RESULT, requestId: request.requestId, ok: true })
  await setting

  child.emit('message', { type: CREDENTIAL_BINDINGS, bindings: [{ reference, providerId: 'provider-2' }] })
  assert.deepEqual(bindings, [[{ reference, providerId: 'provider-2' }]])
  await assert.rejects(() => client.delete(reference), /did not acknowledge/)
  client.close()
  await assert.rejects(() => client.set(reference, 'another-secret'), /not available/)
})
