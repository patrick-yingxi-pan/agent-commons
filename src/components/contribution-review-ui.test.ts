/** Structural lock for acknowledgement-owned exact-version Contribution review. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

test('Contribution review is one exact shell-owned model act with a held lifecycle', () => {
  const view = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  const commands = stripComments(read(join(ROOT, 'src', 'api', 'contributionReviewCommands.ts')))
  const legacyCommands = stripComments(read(join(ROOT, 'src', 'api', 'commands.ts')))
  const facade = stripComments(read(join(ROOT, 'src', 'controller', 'contributionReviewMutations.ts')))
  const runtime = stripComments(read(join(ROOT, 'src', 'controller', 'contributionReviewMutationRuntime.ts')))
  const routes = stripComments(read(join(ROOT, 'server', 'routes', 'index.ts')))
  const store = stripComments(read(join(ROOT, 'server', 'store', 'index.ts')))
  const notice = stripComments(read(join(ROOT, 'src', 'components', 'ContributionReviewMutationNotice.tsx')))
  const shell = stripComments(read(join(ROOT, 'src', 'components', 'ShellMutationNotices.tsx')))

  assert.doesNotMatch(legacyCommands, /export async function reviewContribution/)
  assert.match(view, /useContributionReviewStatus\(\)/)
  assert.match(view, /heldContributionReviewIntent\(project\.id, contributionId\)/)
  assert.match(view, /isContributionReviewHeld\(project\.id, contributionId\)/)
  assert.match(view, /const lifecycleHeld =[^\n]*reviewHeld/,
    'review uncertainty excludes every competing lifecycle act')
  assert.match(view, /enqueueContributionReview\(\{[\s\S]*reviewedVersion: latestVersion/)
  assert.match(view, /`Reviewing v\$\{heldReview\?\.reviewedVersion \?\? latestVersion\}…`/)
  assert.match(view, /disabled=\{commentHeld\}/,
    'the orthogonal comment composer remains available during review')
  assert.doesNotMatch(view, /confirmLabel=["'{]Run review/,
    'the visible changeset is the substantive review surface')

  assert.match(facade, /const existing = heldReviews\.get\(key\)[\s\S]*if \(existing\) return existing\.result/)
  assert.match(facade, /intentId: crypto\.randomUUID\(\)/)
  assert.match(facade, /onAccountSwitch\([\s\S]*heldReviews\.clear\(\)/)
  assert.match(commands, /expectedVersion: intent\.reviewedVersion/)
  assert.match(commands, /apiPost<Contribution>[\s\S]*\{ idempotencyKey \}/)
  assert.match(commands, /event\.id === expectedId &&[\s\S]*event\.kind === 'review-passed' &&[\s\S]*event\.reviewedVersion === reviewedVersion/)
  assert.match(commands, /latest === intent\.reviewedVersion[\s\S]*contribution\.reviewedVersion === intent\.reviewedVersion/,
    'a delayed receipt cannot mark a newer changeset reviewed')
  assert.match(runtime, /createAcknowledgedActionMutationController/)
  assert.match(runtime, /mintIdempotencyKey: \(intent\) => intent\.intentId/)

  const routeStart = routes.indexOf("r.post('/projects/:id/contributions/:cid/review'")
  const routeEnd = routes.indexOf("r.formGet('/a2a/card'", routeStart)
  assert.ok(routeStart >= 0 && routeEnd > routeStart)
  const route = routes.slice(routeStart, routeEnd)
  assert.match(route, /async \(\{ req, res, params, body \}\)/)
  assert.match(route, /expectedVersion[\s\S]*getContributionReview[\s\S]*logicalId: logicalReviewId/)

  const storeStart = store.indexOf('  getContributionReview(')
  const storeEnd = store.indexOf('  requireContributionReview(', storeStart)
  const reviewStart = store.indexOf('  reviewContribution(', storeEnd)
  const reviewEnd = store.indexOf('  getContributionCrystallization(', reviewStart)
  assert.ok(storeStart >= 0 && storeEnd > storeStart && reviewStart > storeEnd && reviewEnd > reviewStart)
  assert.match(store.slice(storeStart, storeEnd), /event\.reviewedByTenant !== tenantId/)
  assert.match(store.slice(reviewStart, reviewEnd), /options\.expectedVersion !== latest[\s\S]*return 'stale'/)
  assert.match(store.slice(reviewStart, reviewEnd), /return commitMutationBatch\(\(\) => \{[\s\S]*reviewedVersion: latest[\s\S]*reviewedByTenant: tenantId[\s\S]*persist\(\)/,
    'version stamp, receipt, publication, and persistence share one commit')
  assert.match(notice, /kind="contribution-review"/)
  assert.match(shell, /<ContributionReviewMutationNotice \/>/)
})
