import { test } from 'node:test'
import assert from 'node:assert/strict'
import { adminActionRealized, type AdminActionTarget } from './adminActionRevision.ts'

test('maintainer action recovery requires exact echoed desired state', () => {
  const deactivate: AdminActionTarget = { kind: 'deactivate-user', userId: 'user-1' }
  assert.equal(adminActionRealized({ ...deactivate, deactivated: true }, deactivate), true)
  assert.equal(adminActionRealized({ ...deactivate, deactivated: false }, deactivate), false)
  assert.equal(
    adminActionRealized({ kind: 'deactivate-user', userId: 'user-2', deactivated: true }, deactivate),
    false,
    'another account cannot settle this action',
  )

  const token: AdminActionTarget = { kind: 'revoke-token', userId: 'user-1', tokenId: 'token-1' }
  assert.equal(adminActionRealized({ ...token, revoked: true }, token), true)
  assert.equal(adminActionRealized({ ...token, revoked: false }, token), false)
  assert.equal(
    adminActionRealized({ kind: 'revoke-token', userId: 'user-1', tokenId: 'token-2', revoked: true }, token),
    false,
  )

  const invite: AdminActionTarget = { kind: 'revoke-invite', inviteId: 'invite-1' }
  assert.equal(adminActionRealized({ ...invite, status: 'revoked' }, invite), true)
  assert.equal(adminActionRealized({ ...invite, status: 'absent' }, invite), true)
  assert.equal(adminActionRealized({ ...invite, status: 'invited' }, invite), false)
  assert.equal(adminActionRealized({ ...invite, status: 'accepted' }, invite), false)
  assert.equal(adminActionRealized({ ...invite, status: 'declined' }, invite), false)
})
