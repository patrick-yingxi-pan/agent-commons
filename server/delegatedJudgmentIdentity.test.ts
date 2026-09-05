import test from 'node:test'
import assert from 'node:assert/strict'
import { delegatedJudgmentId, isDelegatedJudgmentId } from './delegatedJudgmentIdentity.ts'

test('delegated judgment receipt identity is deterministic, scoped, and opaque', () => {
  const id = delegatedJudgmentId('tenant-a', 'project-a', 'contribution-a', 'delegation-a', 'retry-key')
  assert.equal(id, delegatedJudgmentId('tenant-a', 'project-a', 'contribution-a', 'delegation-a', 'retry-key'))
  assert.match(id, /^delegated-judgment-[a-f0-9]{24}$/)
  assert.equal(isDelegatedJudgmentId(id), true)
  assert.notEqual(id, delegatedJudgmentId('tenant-b', 'project-a', 'contribution-a', 'delegation-a', 'retry-key'))
  assert.notEqual(id, delegatedJudgmentId('tenant-a', 'project-b', 'contribution-a', 'delegation-a', 'retry-key'))
  assert.notEqual(id, delegatedJudgmentId('tenant-a', 'project-a', 'contribution-b', 'delegation-a', 'retry-key'))
  assert.notEqual(id, delegatedJudgmentId('tenant-a', 'project-a', 'contribution-a', 'delegation-b', 'retry-key'))
  assert.notEqual(id, delegatedJudgmentId('tenant-a', 'project-a', 'contribution-a', 'delegation-a', 'another-key'))
  assert.doesNotMatch(id, /tenant|project-a|contribution-a|delegation-a|retry-key/)
  assert.equal(isDelegatedJudgmentId('delegated-judgment-not-a-receipt'), false)
})
