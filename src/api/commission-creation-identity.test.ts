import test from 'node:test'
import assert from 'node:assert/strict'
import { commissionCreationId as serverCommissionCreationId } from '../../server/commissionCreationIdentity.ts'
import { commissionCreationId } from './commissionCreationIdentity.ts'

test('browser and server derive the same opaque Commission identity', async () => {
  const tenantId = 'tenant-commission-parity'
  const key = 'commission-create-parity-key'
  assert.equal(
    await commissionCreationId(tenantId, key),
    serverCommissionCreationId(tenantId, key),
  )
})
