import test from 'node:test'
import assert from 'node:assert/strict'
import { contributionCrystallizationId as serverContributionCrystallizationId } from '../../server/contributionCrystallizationIdentity.ts'
import { contributionCrystallizationId } from './contributionCrystallizationIdentity.ts'

test('browser and server derive the same opaque Contribution crystallization receipt', async () => {
  const tenantId = 'tenant-crystallization-parity'
  const projectId = 'project-crystallization-parity'
  const contributionId = 'contribution-crystallization-parity'
  const key = 'contribution-crystallization-parity-key'
  assert.equal(
    await contributionCrystallizationId(tenantId, projectId, contributionId, key),
    serverContributionCrystallizationId(tenantId, projectId, contributionId, key),
  )
})
