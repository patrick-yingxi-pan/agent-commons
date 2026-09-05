import test from 'node:test'
import assert from 'node:assert/strict'
import { contributionCommentCreationId as serverContributionCommentCreationId } from '../../server/contributionCommentCreationIdentity.ts'
import { contributionCommentCreationId } from './contributionCommentCreationIdentity.ts'

test('browser and server derive the same opaque Contribution comment receipt', async () => {
  const tenantId = 'tenant-contribution-comment-parity'
  const projectId = 'project-contribution-comment-parity'
  const contributionId = 'contribution-comment-parity'
  const key = 'contribution-comment-parity-key'
  assert.equal(
    await contributionCommentCreationId(tenantId, projectId, contributionId, key),
    serverContributionCommentCreationId(tenantId, projectId, contributionId, key),
  )
})
