import test from 'node:test'
import assert from 'node:assert/strict'
import { orgCreationId as serverOrgCreationId } from '../../server/orgCreationIdentity.ts'
import { orgCreationId } from './orgCreationIdentity.ts'

test('browser and server derive the same opaque organization identity', async () => {
  const tenantId = 'tenant-org-parity'
  const key = 'org-create-parity-key'
  assert.equal(await orgCreationId(tenantId, key), serverOrgCreationId(tenantId, key))
  assert.notEqual(await orgCreationId('another-tenant', key), serverOrgCreationId(tenantId, key))
})
