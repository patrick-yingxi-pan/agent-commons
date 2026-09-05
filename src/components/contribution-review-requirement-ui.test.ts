/** Structural lock for acknowledgement-owned Contribution review requirement. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

test('Require review is one held monotonic act with exact receipt reconciliation', () => {
  const view = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  const commands = stripComments(read(join(ROOT, 'src', 'api', 'contributionReviewRequirementCommands.ts')))
  const legacyCommands = stripComments(read(join(ROOT, 'src', 'api', 'commands.ts')))
  const facade = stripComments(read(join(ROOT, 'src', 'controller', 'contributionReviewRequirementMutations.ts')))
  const runtime = stripComments(read(join(ROOT, 'src', 'controller', 'contributionReviewRequirementMutationRuntime.ts')))
  const routes = stripComments(read(join(ROOT, 'server', 'routes', 'index.ts')))
  const store = stripComments(read(join(ROOT, 'server', 'store', 'index.ts')))
  const notice = stripComments(read(join(ROOT, 'src', 'components', 'ContributionReviewRequirementMutationNotice.tsx')))
  const shell = stripComments(read(join(ROOT, 'src', 'components', 'ShellMutationNotices.tsx')))

  assert.doesNotMatch(legacyCommands, /export async function requireContributionReview/)
  assert.match(view, /useContributionReviewRequirementStatus\(\)/)
  assert.match(view, /isContributionReviewRequirementHeld\(project\.id, contributionId\)/)
  assert.match(view, /const lifecycleHeld =[^\n]*reviewRequirementHeld/,
    'tightening uncertainty excludes every competing lifecycle act')
  assert.match(view, /enqueueContributionReviewRequirement\(\{[\s\S]*tenantId: me\.tenant\.id,[\s\S]*projectId: project\.id,[\s\S]*contributionId: c\.id/)
  assert.match(view, /reviewRequirementHeld \? 'Requiring review…' : 'Require review'/)
  assert.match(view, /disabled=\{commentHeld\}/,
    'the orthogonal comment composer remains available while the gate tightens')

  assert.match(facade, /const existing = heldRequirements\.get\(key\)[\s\S]*if \(existing\) return existing\.result/)
  assert.match(facade, /intentId: crypto\.randomUUID\(\)/)
  assert.match(facade, /onAccountSwitch\([\s\S]*heldRequirements\.clear\(\)/)
  assert.match(commands, /apiPost<Contribution>[\s\S]*\{ idempotencyKey \}/)
  assert.match(commands, /event\.id === expectedId && event\.kind === 'review-required'/)
  assert.match(commands, /return \{ \.\.\.candidate, reviewRequired: true, events \}/,
    'reconciliation merges only the monotonic flag and exact receipt')
  assert.doesNotMatch(commands, /return contribution\s*\n/,
    'a delayed acknowledgement cannot replace current Contribution truth')
  assert.match(runtime, /createAcknowledgedActionMutationController/)
  assert.match(runtime, /mintIdempotencyKey: \(intent\) => intent\.intentId/)

  const routeStart = routes.indexOf("r.post('/projects/:id/contributions/:cid/require-review'")
  const routeEnd = routes.indexOf("r.post('/projects/:id/contributions/:cid/review'", routeStart)
  assert.ok(routeStart >= 0 && routeEnd > routeStart)
  const route = routes.slice(routeStart, routeEnd)
  assert.match(route, /contributionReviewRequirementId\(who\.tenant\.id, params\.id, params\.cid, idempotencyKey\)/)
  assert.match(route, /getContributionReviewRequirement\([\s\S]*if \(typeof represented === 'object'\) return sendJson/)
  assert.match(route, /requireContributionReview\([\s\S]*\{ logicalId: logicalRequirementId \}/)

  const storeStart = store.indexOf('  getContributionReviewRequirement(')
  const storeEnd = store.indexOf('  reviewContribution(', storeStart)
  assert.ok(storeStart >= 0 && storeEnd > storeStart)
  const storeSlice = store.slice(storeStart, storeEnd)
  assert.match(storeSlice, /event\.reviewRequiredByTenant !== tenantId/)
  assert.match(storeSlice, /return commitMutationBatch\(\(\) => \{[\s\S]*reviewRequired = true[\s\S]*reviewRequiredByTenant: tenantId[\s\S]*emit\([\s\S]*persist\(\)/,
    'the flag, receipt, publication, and persistence share one commit')
  assert.match(notice, /kind="contribution-require-review"/)
  assert.match(shell, /<ContributionReviewRequirementMutationNotice \/>/)
})
