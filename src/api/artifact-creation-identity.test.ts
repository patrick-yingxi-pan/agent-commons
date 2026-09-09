import { test } from 'node:test'
import assert from 'node:assert/strict'
import { artifactCreationId as serverArtifactCreationId } from '../../server/artifactCreationIdentity.ts'
import { artifactCreationId } from './artifactCreationIdentity.ts'

test('browser reconciliation and the server derive the same opaque direct Artifact identity', async () => {
  const tenantId = 'tenant-artifact-creation-parity'
  const key = 'artifact-creation-logical-key'
  const expected = serverArtifactCreationId(tenantId, key)
  assert.equal(await artifactCreationId(tenantId, key), expected)
  assert.match(expected, /^artifact-new-[a-f0-9]{24}$/)
  assert.doesNotMatch(expected, /artifact-creation-parity|logical-key/)
})
