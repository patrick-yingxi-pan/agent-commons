import test from 'node:test'
import assert from 'node:assert/strict'
import { delegationCreationId as serverDelegationCreationId } from '../../server/delegationCreationIdentity.ts'
import { delegationCreationId } from './delegationCreationIdentity.ts'

test('browser and server derive the same opaque Delegation identity', async () => {
  const tenantId = 'tenant-delegation-parity'
  const projectId = 'project-delegation-parity'
  const key = 'delegation-create-parity-key'
  assert.equal(
    await delegationCreationId(tenantId, projectId, key),
    serverDelegationCreationId(tenantId, projectId, key),
  )
})
