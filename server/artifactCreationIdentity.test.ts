import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { isArtifactCreationId } from '../contract/artifactCreation.ts'
import { artifactCreationId } from './artifactCreationIdentity.ts'

test('direct artifact creation identity is tenant scoped, deterministic, opaque, and domain separated', () => {
  const tenant = 'tenant-artifact-workspace'
  const key = 'direct-artifact-logical-key-that-must-not-leak'
  const first = artifactCreationId(tenant, key)
  const expected = `artifact-new-${createHash('sha256').update(`${tenant}\0${key}`).digest('hex').slice(0, 24)}`

  assert.equal(first, expected, 'the durable identity uses the declared tenant/key domain exactly')
  assert.equal(first, artifactCreationId(tenant, key))
  assert.notEqual(first, artifactCreationId('tenant-other-workspace', key))
  assert.notEqual(first, artifactCreationId(tenant, 'another-logical-key'))
  assert.match(first, /^artifact-new-[a-f0-9]{24}$/)
  assert.equal(isArtifactCreationId(first), true)
  assert.equal(isArtifactCreationId('a-new-0123456789abcdef01234567'), false)
  assert.equal(isArtifactCreationId('artifact-new-not-a-digest'), false)
  assert.doesNotMatch(first, /artifact-workspace|logical-key/)
})
