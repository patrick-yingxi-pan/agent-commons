import test from 'node:test'
import assert from 'node:assert/strict'
import { contributionEffectExecutionId as serverContributionEffectExecutionId } from '../../server/contributionEffectExecutionIdentity.ts'
import { contributionEffectExecutionId } from './contributionEffectExecutionIdentity.ts'

test('browser and server derive the same opaque Contribution effect receipt identity', async () => {
  const tenantId = 'tenant-effect-parity'
  const projectId = 'project-effect-parity'
  const contributionId = 'contribution-effect-parity'
  const key = 'contribution-effect-parity-key'
  assert.equal(
    await contributionEffectExecutionId(tenantId, projectId, contributionId, key),
    serverContributionEffectExecutionId(tenantId, projectId, contributionId, key),
  )
})
