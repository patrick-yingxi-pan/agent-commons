import test from 'node:test'
import assert from 'node:assert/strict'
import type { Grant } from '../../contract/index.ts'
import {
  grantMutationRealized,
  type GrantMutationIntent,
} from './grantRevision.ts'

const subject = { kind: 'project', id: 'p-grant-reconcile' } as const
const row = (overrides: Partial<Grant> = {}): Grant => ({
  id: 'grant-1',
  subject,
  audience: { kind: 'org', orgId: 'tenant-beta' },
  tier: 'view',
  grantedBy: 'Ada',
  grantedAt: 1,
  ...overrides,
})

test('directed grant reconciliation requires the exact audience, tier, and canonical note', () => {
  const intent: GrantMutationIntent = {
    kind: 'upsert',
    request: {
      subject,
      audience: { kind: 'org', orgId: 'tenant-beta' },
      tier: 'comment',
      note: '  Please review  ',
    },
  }
  const baseline = { grants: [row()], known: true }
  assert.equal(grantMutationRealized(intent, baseline, [row({ tier: 'comment', note: 'Please review' })]), true)
  assert.equal(grantMutationRealized(intent, baseline, [row({ tier: 'view', note: 'Please review' })]), false)
  assert.equal(grantMutationRealized(intent, baseline, [row({ tier: 'comment' })]), false)
})

test('link reconciliation proves rotation against the frozen baseline token', () => {
  const intent: GrantMutationIntent = {
    kind: 'upsert',
    request: { subject, audience: { kind: 'link', token: '' }, tier: 'view' },
  }
  const before = row({ audience: { kind: 'link', token: 'old-token' } })
  assert.equal(grantMutationRealized(intent, { grants: [before], known: true }, [before]), false)
  assert.equal(
    grantMutationRealized(intent, { grants: [before], known: true }, [row({ audience: { kind: 'link', token: 'new-token' } })]),
    true,
  )
  assert.equal(
    grantMutationRealized(intent, { grants: [], known: false }, [row({ audience: { kind: 'link', token: 'already-there' } })]),
    false,
    'an unloaded roster cannot prove that an existing token is a new rotation',
  )
  assert.equal(
    grantMutationRealized(intent, { grants: [], known: true }, [row({ audience: { kind: 'link', token: 'first-token' } })]),
    true,
    'a known-empty baseline proves first link creation',
  )
})

test('revoke reconciliation requires authoritative absence', () => {
  const replacement = row({ id: 'grant-2', tier: 'propose' })
  assert.equal(
    grantMutationRealized({ kind: 'revoke', grant: replacement }, { grants: [replacement], known: true }, []),
    true,
  )
  assert.equal(
    grantMutationRealized({ kind: 'revoke', grant: replacement }, { grants: [replacement], known: true }, [replacement]),
    false,
  )
})
