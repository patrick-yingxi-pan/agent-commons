import test from 'node:test'
import assert from 'node:assert/strict'
import { socialProposalCreationId as serverSocialProposalCreationId } from '../../server/socialProposalCreationIdentity.ts'
import { socialProposalCreationId } from './socialProposalCreationIdentity.ts'

test('browser and server derive the same opaque social Proposal identity', async () => {
  const tenantId = 'tenant-proposal-parity'
  const key = 'proposal-create-parity-key'
  assert.equal(
    await socialProposalCreationId(tenantId, key),
    serverSocialProposalCreationId(tenantId, key),
  )
})
