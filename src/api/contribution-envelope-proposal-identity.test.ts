import test from 'node:test'
import assert from 'node:assert/strict'
import { contributionEnvelopeProposalId as serverContributionEnvelopeProposalId } from '../../server/contributionEnvelopeProposalIdentity.ts'
import { contributionEnvelopeProposalId } from './contributionEnvelopeProposalIdentity.ts'

test('browser and server derive the same opaque Contribution envelope proposal receipt', async () => {
  const tenantId = 'tenant-envelope-proposal-parity'
  const projectId = 'project-envelope-proposal-parity'
  const contributionId = 'contribution-envelope-proposal-parity'
  const key = 'contribution-envelope-proposal-parity-key'
  assert.equal(
    await contributionEnvelopeProposalId(tenantId, projectId, contributionId, key),
    serverContributionEnvelopeProposalId(tenantId, projectId, contributionId, key),
  )
})
