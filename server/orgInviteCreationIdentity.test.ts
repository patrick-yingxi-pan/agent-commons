import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isOrgInviteCreationId,
  orgInviteAddressAudience,
  orgInviteCreationId,
} from './orgInviteCreationIdentity.ts'

test('organization invitation identity is deterministic, actor/org-scoped, and opaque', () => {
  const key = 'org-invite-key-that-must-not-leak'
  const first = orgInviteCreationId('tenant-org-a', 'user-owner-a', key)
  assert.equal(first, orgInviteCreationId('tenant-org-a', 'user-owner-a', key))
  assert.notEqual(first, orgInviteCreationId('tenant-org-b', 'user-owner-a', key))
  assert.notEqual(first, orgInviteCreationId('tenant-org-a', 'user-owner-b', key))
  assert.match(first, /^invite-new-[a-f0-9]{24}$/)
  assert.doesNotMatch(first, /tenant-org|user-owner|org-invite-key/)
  assert.equal(isOrgInviteCreationId(first), true)
  assert.equal(isOrgInviteCreationId('invite-42'), false)
})

test('invitation address audiences normalize without disclosing registration or raw address', () => {
  const known = orgInviteAddressAudience(' Known@Example.test ')
  assert.equal(known, orgInviteAddressAudience('known@example.test'))
  assert.notEqual(known, orgInviteAddressAudience('unknown@example.test'))
  assert.match(known, /^address-audience-[a-f0-9]{24}$/)
  assert.doesNotMatch(known, /known|example|@/)
})
