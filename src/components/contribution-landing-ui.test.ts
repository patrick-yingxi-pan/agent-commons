/** Structural lock for acknowledgement-owned Contribution landing. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

test('Contribution landing is one shell-owned durable act on its substantive review page', () => {
  const view = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  const commands = stripComments(read(join(ROOT, 'src', 'api', 'contributionLandingCommands.ts')))
  const legacyCommands = stripComments(read(join(ROOT, 'src', 'api', 'commands.ts')))
  const facade = stripComments(read(join(ROOT, 'src', 'controller', 'contributionLandingMutations.ts')))
  const runtime = stripComments(read(join(ROOT, 'src', 'controller', 'contributionLandingMutationRuntime.ts')))
  const routes = stripComments(read(join(ROOT, 'server', 'routes', 'index.ts')))
  const store = stripComments(read(join(ROOT, 'server', 'store', 'index.ts')))
  const notice = stripComments(read(join(ROOT, 'src', 'components', 'ContributionLandingMutationNotice.tsx')))
  const shell = stripComments(read(join(ROOT, 'src', 'components', 'ShellMutationNotices.tsx')))

  assert.doesNotMatch(legacyCommands, /export async function landContribution/)
  assert.match(view, /useContributionLandingStatus\(\)/)
  assert.match(view, /isContributionLandingHeld\(project\.id, contributionId\)/)
  assert.match(view, /enqueueContributionLanding\(/)
  assert.match(view, /const lifecycleHeld = landingHeld \|\| effectExecutionHeld/)
  assert.match(view, /ChangesetCard project=\{project\} c=\{c\} lifecycleHeld=\{contributionActionHeld\}/)
  assert.match(view, /<DeferredContributionEnvelopeCard[\s\S]*lifecycleHeld=\{contributionActionHeld\}/)
  assert.match(view, /landingHeld \? 'Landing…' : 'Land'/)
  assert.doesNotMatch(view, /confirmLabel=["'{]Land/,
    'the canonical page already presents the changeset, envelope, tier, and exact next ledger position')
  assert.match(facade, /const existing = heldLandings\.get\(key\)[\s\S]*if \(existing\) return existing\.result/)
  assert.match(facade, /intentId: crypto\.randomUUID\(\)/)
  assert.match(commands, /apiPost<Contribution>[\s\S]*\{ idempotencyKey \}/)
  assert.match(commands, /contribution\.status === 'landed'[\s\S]*Number\.isSafeInteger\(contribution\.landingNumber\)/)
  assert.match(commands, /candidate\.status !== 'landed'[\s\S]*invalidate\(keys\.attention/,
    'a delayed landing acknowledgement cannot erase newer landed history')
  assert.match(runtime, /createAcknowledgedActionMutationController/)

  const routeStart = routes.indexOf("r.post('/projects/:id/contributions/:cid/land'")
  const routeEnd = routes.indexOf("r.post('/projects/:id/contributions/:cid/require-review'", routeStart)
  assert.ok(routeStart >= 0 && routeEnd > routeStart)
  assert.match(routes.slice(routeStart, routeEnd), /getContributionLanding[\s\S]*if \(typeof represented === 'object'\) return sendJson/)
  const storeStart = store.indexOf('  getContributionLanding(')
  const storeEnd = store.indexOf('  attentionLedger(', storeStart)
  assert.ok(storeStart >= 0 && storeEnd > storeStart)
  assert.match(store.slice(storeStart, storeEnd), /return commitMutationBatch\(\(\) => \{[\s\S]*landedByTenant[\s\S]*landingId[\s\S]*persist\(\)/)
  assert.match(notice, /kind="contribution-land"/)
  assert.match(shell, /<ContributionLandingMutationNotice \/>/)
})
