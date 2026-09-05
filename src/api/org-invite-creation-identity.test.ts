import test from 'node:test'
import assert from 'node:assert/strict'
import { orgInviteCreationId as serverOrgInviteCreationId } from '../../server/orgInviteCreationIdentity.ts'
import { orgInviteCreationId } from './orgInviteCreationIdentity.ts'

test('browser and server derive the same opaque owner invitation identity', async () => {
  const orgId = 'tenant-org-invite-parity'
  const ownerUserId = 'user-owner-parity'
  const key = 'org-invite-parity-key'
  assert.equal(
    await orgInviteCreationId(orgId, ownerUserId, key),
    serverOrgInviteCreationId(orgId, ownerUserId, key),
  )
  assert.notEqual(
    await orgInviteCreationId(orgId, 'another-owner', key),
    serverOrgInviteCreationId(orgId, ownerUserId, key),
  )
})
