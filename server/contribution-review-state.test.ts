import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import type { ChangesetVersion, ContributionReviewerBinding } from '../contract/index.ts'
import {
  publicReviewRun,
  realReviewVersion,
  reviewChangesetHash,
  validReviewerBinding,
  validStoredReviews,
  type StoredContributionReview,
} from './contributionReviewState.ts'

const binding: ContributionReviewerBinding = {
  agentId: 'reviewer-agent',
  agentRevision: 4,
  providerId: 'provider-selected',
  providerRevision: 7,
  connectionRevision: 2,
}

const versionOne: ChangesetVersion = {
  version: 1,
  at: 100,
  by: 'Contributor',
  entries: [{ id: 'entry-one', kind: 'note', target: 'policy', after: 'Initial text.' }],
}

const versionTwo: ChangesetVersion = {
  version: 2,
  at: 200,
  by: 'Contributor',
  entries: [{ id: 'entry-two', kind: 'note', target: 'policy', before: 'Initial text.', after: 'Revised text.' }],
}

function run(
  id: string,
  version: ChangesetVersion,
  status: StoredContributionReview['status'],
  result?: { summary: string; findings: Array<{ entryId: string; body: string }> },
): StoredContributionReview {
  const startedAt = 300
  return {
    id: `contribution-review-${createHash('sha256').update(id).digest('hex').slice(0, 24)}`,
    version: version.version,
    tenantId: 'tenant-private-review-owner',
    binding: { ...binding },
    changesetHash: reviewChangesetHash(version),
    reviewer: 'Selected Agent',
    provider: 'Selected Provider',
    model: 'review-model',
    startedAt,
    ...(status === 'pending' ? {} : { finishedAt: startedAt + 1 }),
    status,
    ...(result ? { summary: result.summary, findings: result.findings } : {}),
  }
}

const passed = (id: string, version: ChangesetVersion) => run(id, version, 'passed', { summary: 'No concrete concern found.', findings: [] })
const finding = (id: string, version: ChangesetVersion) => run(id, version, 'findings', {
  summary: 'One concern needs attention.',
  findings: [{ entryId: version.entries[0].id, body: 'The revised behavior has no rollback condition.' }],
})

test('reviewer bindings are exact, bounded, and revision-shaped', () => {
  assert.equal(validReviewerBinding(binding), true)
  assert.equal(validReviewerBinding({ ...binding, unknown: true }), false)
  assert.equal(validReviewerBinding({ ...binding, agentId: '' }), false)
  assert.equal(validReviewerBinding({ ...binding, providerId: ' provider-selected' }), false)
  assert.equal(validReviewerBinding({ ...binding, agentId: 'a'.repeat(201) }), false)
  assert.equal(validReviewerBinding({ ...binding, connectionRevision: -1 }), false)
  assert.equal(validReviewerBinding({ ...binding, providerRevision: 1.5 }), false)
  assert.equal(validReviewerBinding({ ...binding, agentRevision: Number.MAX_SAFE_INTEGER + 1 }), false)
  assert.equal(validReviewerBinding({ agentId: binding.agentId, providerId: binding.providerId }), false)
})

test('public review projection redacts private tenant, selected binding, and frozen hash without aliasing', () => {
  const stored = passed('public-redaction', versionOne)
  const publicRun = publicReviewRun(stored)
  assert.deepEqual(publicRun, {
    id: stored.id,
    version: stored.version,
    reviewer: stored.reviewer,
    provider: stored.provider,
    model: stored.model,
    startedAt: stored.startedAt,
    finishedAt: stored.finishedAt,
    status: stored.status,
    summary: stored.summary,
    findings: stored.findings,
  })
  assert.equal(Object.hasOwn(publicRun, 'tenantId'), false)
  assert.equal(Object.hasOwn(publicRun, 'binding'), false)
  assert.equal(Object.hasOwn(publicRun, 'changesetHash'), false)
  publicRun.findings?.push({ entryId: 'mutated', body: 'mutated projection' })
  assert.deepEqual(stored.findings, [])
})

test('persisted lifecycle states admit only coherent pending and terminal result shapes', () => {
  const changesets = [versionOne]
  assert.equal(validStoredReviews(undefined, changesets), true, 'legacy absence means no real-review authority')
  assert.equal(validStoredReviews([], changesets), true)
  assert.equal(validStoredReviews([passed('valid-pass', versionOne)], changesets), true)
  assert.equal(validStoredReviews([finding('valid-findings', versionOne)], changesets), true)
  assert.equal(validStoredReviews([run('valid-pending', versionOne, 'pending')], changesets), true)
  assert.equal(validStoredReviews([run('valid-failed', versionOne, 'failed')], changesets), true)
  assert.equal(validStoredReviews([run('valid-uncertain', versionOne, 'uncertain')], changesets), true)
  assert.equal(validStoredReviews([run('valid-stale', versionOne, 'stale', { summary: 'Superseded review.', findings: [] })], changesets), true)
  assert.equal(validStoredReviews({} as never, changesets), false)

  const bad = (mutate: (attempt: StoredContributionReview) => void) => {
    const attempt = passed('bad-case', versionOne)
    mutate(attempt)
    return validStoredReviews([attempt], changesets)
  }
  assert.equal(bad((attempt) => { attempt.finishedAt = undefined }), false)
  assert.equal(bad((attempt) => { attempt.findings = [{ entryId: 'foreign-entry', body: 'not in changeset' }] }), false, 'passed cannot carry findings')
  assert.equal(bad((attempt) => { attempt.status = 'findings' }), false, 'findings status requires at least one finding')
  assert.equal(bad((attempt) => { attempt.status = 'pending' }), false, 'pending cannot already have a finish time or result')
  assert.equal(bad((attempt) => { attempt.status = 'failed'; attempt.summary = 'claimed result' }), false)
  assert.equal(bad((attempt) => { attempt.status = 'running' as never }), false)
  assert.equal(validStoredReviews([passed('missing-version', versionTwo)], changesets), false)
  assert.equal(validStoredReviews([passed('over-cap', versionOne), ...Array.from({ length: 50 }, (_, i) => passed(`cap-${i}`, versionOne))], changesets), false)
})

test('only the newest attempt for the current frozen version can establish a pass', () => {
  const currentChangesets = [versionOne, versionTwo]
  const oldPass = passed('old-pass', versionOne)
  const currentPass = passed('current-pass', versionTwo)
  assert.equal(realReviewVersion({ changeset: currentChangesets, reviewAttempts: [oldPass] }), undefined)
  assert.equal(realReviewVersion({ changeset: currentChangesets, reviewAttempts: [oldPass, currentPass] }), 2)

  for (const latest of [
    finding('later-findings', versionTwo),
    run('later-pending', versionTwo, 'pending'),
    run('later-failed', versionTwo, 'failed'),
    run('later-uncertain', versionTwo, 'uncertain'),
    run('later-stale', versionTwo, 'stale', { summary: 'Old target.', findings: [] }),
  ]) {
    assert.equal(realReviewVersion({ changeset: currentChangesets, reviewAttempts: [oldPass, currentPass, latest] }), undefined, `${latest.status} supersedes an earlier pass`)
  }

  const stalePass = passed('hash-mismatch', versionTwo)
  stalePass.changesetHash = '0'.repeat(64)
  assert.equal(realReviewVersion({ changeset: currentChangesets, reviewAttempts: [oldPass, stalePass] }), undefined, 'a passed status with a mismatched snapshot hash never qualifies')
  const revisedCurrent = { ...versionTwo, entries: [{ ...versionTwo.entries[0], after: 'changed after review' }] }
  assert.equal(realReviewVersion({ changeset: [versionOne, revisedCurrent], reviewAttempts: [oldPass, currentPass] }), undefined, 'a pass against a superseded frozen body never qualifies')
})
