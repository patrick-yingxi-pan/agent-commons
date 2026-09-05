import test from 'node:test'
import assert from 'node:assert/strict'
import { contributionEnvelopeApprovalId as serverContributionEnvelopeApprovalId } from '../../server/contributionEnvelopeApprovalIdentity.ts'
import { contributionEnvelopeApprovalId } from './contributionEnvelopeApprovalIdentity.ts'

test('browser and server derive the same opaque Contribution envelope approval receipt', async () => {
  const tenantId = 'tenant-envelope-approval-parity'
  const projectId = 'project-envelope-approval-parity'
  const contributionId = 'contribution-envelope-approval-parity'
  const key = 'contribution-envelope-approval-parity-key'
  assert.equal(
    await contributionEnvelopeApprovalId(tenantId, projectId, contributionId, key),
    serverContributionEnvelopeApprovalId(tenantId, projectId, contributionId, key),
  )
})
