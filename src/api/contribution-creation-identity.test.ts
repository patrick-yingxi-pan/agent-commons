import test from 'node:test'
import assert from 'node:assert/strict'
import { contributionCreationId as serverContributionCreationId } from '../../server/contributionCreationIdentity.ts'
import { contributionCreationId } from './contributionCreationIdentity.ts'

test('browser and server derive the same opaque Contribution identity', async () => {
  const tenantId = 'tenant-contribution-parity'
  const projectId = 'project-contribution-parity'
  const key = 'contribution-create-parity-key'
  assert.equal(
    await contributionCreationId(tenantId, projectId, key),
    serverContributionCreationId(tenantId, projectId, key),
  )
})
