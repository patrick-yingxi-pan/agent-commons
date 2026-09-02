import test from 'node:test'
import assert from 'node:assert/strict'
import type { Discussion } from '../../contract/index.ts'
import {
  discussionWithPost,
  socialPostResourceId,
  type SocialPostMutationIntent,
} from './socialPostRevision.ts'

const base = { tenantId: 'tenant-a', logicalKey: 'key-a', body: 'Hello' }

test('an anchored thread keeps one hold before and after its server id is known', () => {
  const open: SocialPostMutationIntent = {
    ...base,
    kind: 'open',
    subject: { kind: 'artifact', id: 'artifact-a' },
    locus: { kind: 'artifact-block', block: 2 },
  }
  const append: SocialPostMutationIntent = {
    ...base,
    kind: 'append',
    subject: open.subject,
    locus: open.locus,
    discussionId: 'disc-server-minted',
  }
  assert.equal(socialPostResourceId(open), socialPostResourceId(append))
})

test('exact durable post identity, not body or thread activity, proves realization', () => {
  const discussion: Discussion = {
    id: 'disc-a',
    anchor: { ref: { kind: 'project', id: 'project-a' } },
    state: 'open',
    openedBy: 'Ada',
    openedAt: 1,
    posts: [
      { id: 'other-post', author: 'Grace', body: 'Same prose', at: 1, reactions: 0 },
      { id: 'dpost-new-target', author: 'Ada', body: 'Same prose', at: 2, reactions: 0 },
    ],
  }
  assert.equal(discussionWithPost([discussion], 'dpost-new-target')?.id, discussion.id)
  assert.equal(discussionWithPost([discussion], 'missing'), undefined)
})
