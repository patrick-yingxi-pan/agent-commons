import test from 'node:test'
import assert from 'node:assert/strict'
import { providerCreationId as serverProviderCreationId } from '../../server/providerCreationIdentity.ts'
import { providerCreationId } from './providerCreationIdentity.ts'

test('browser and server derive the same opaque provider identity', async () => {
  const tenantId = 'tenant-provider-parity'
  const key = 'provider-create-parity-key'
  assert.equal(await providerCreationId(tenantId, key), serverProviderCreationId(tenantId, key))
})
