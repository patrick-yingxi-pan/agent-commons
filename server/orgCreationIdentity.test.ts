import test from 'node:test'
import assert from 'node:assert/strict'
import { isOrgCreationId, orgCreationId } from './orgCreationIdentity.ts'

test('organization founding identity is deterministic, tenant-scoped, and opaque', () => {
  const key = 'org-create-key-that-must-not-leak'
  const first = orgCreationId('tenant-founder-a', key)
  assert.equal(first, orgCreationId('tenant-founder-a', key))
  assert.notEqual(first, orgCreationId('tenant-founder-b', key))
  assert.match(first, /^tenant-org-new-[a-f0-9]{24}$/)
  assert.doesNotMatch(first, /tenant-founder|org-create-key/)
  assert.equal(isOrgCreationId(first), true)
  assert.equal(isOrgCreationId('tenant-org-42'), false)
})
