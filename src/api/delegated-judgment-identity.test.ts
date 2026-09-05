import test from 'node:test'
import assert from 'node:assert/strict'
import { delegatedJudgmentId as serverId } from '../../server/delegatedJudgmentIdentity.ts'
import { delegatedJudgmentId as browserId } from './delegatedJudgmentIdentity.ts'

test('browser and server derive the same delegated judgment receipt identity', async () => {
  const args = ['tenant-a', 'project-a', 'contribution-a', 'delegation-a', 'retry-key'] as const
  assert.equal(await browserId(...args), serverId(...args))
})
