import test from 'node:test'
import assert from 'node:assert/strict'
import { openWorkCreationId as serverOpenWorkCreationId } from '../../server/openWorkCreationIdentity.ts'
import { openWorkCreationId } from './openWorkCreationIdentity.ts'

test('browser and server derive the same opaque open-work identity', async () => {
  const tenantId = 'tenant-open-work-parity'
  const projectId = 'project-open-work-parity'
  const key = 'open-work-create-parity-key'
  assert.equal(
    await openWorkCreationId(tenantId, projectId, key),
    serverOpenWorkCreationId(tenantId, projectId, key),
  )
})
