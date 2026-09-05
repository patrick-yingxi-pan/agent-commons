/** Structural lock for acknowledgement-owned Contribution crystallization. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

test('crystallization is one exact shell-owned append with a durable held draft', () => {
  const view = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  const commands = stripComments(read(join(ROOT, 'src', 'api', 'contributionCrystallizationCommands.ts')))
  const legacyCommands = stripComments(read(join(ROOT, 'src', 'api', 'commands.ts')))
  const facade = stripComments(read(join(ROOT, 'src', 'controller', 'contributionCrystallizationMutations.ts')))
  const runtime = stripComments(read(join(ROOT, 'src', 'controller', 'contributionCrystallizationMutationRuntime.ts')))
  const routes = stripComments(read(join(ROOT, 'server', 'routes', 'index.ts')))
  const store = stripComments(read(join(ROOT, 'server', 'store', 'index.ts')))
  const notice = stripComments(read(join(ROOT, 'src', 'components', 'ContributionCrystallizationMutationNotice.tsx')))
  const shell = stripComments(read(join(ROOT, 'src', 'components', 'ShellMutationNotices.tsx')))

  assert.doesNotMatch(legacyCommands, /export async function crystallizeContribution/)
  assert.match(view, /useContributionCrystallizationStatus\(\)/)
  assert.match(view, /isContributionCrystallizationHeld\(project\.id, contributionId\)/)
  assert.match(view, /landingHeld \|\| effectExecutionHeld \|\| crystallizationHeld/)
  assert.match(view, /enqueueContributionCrystallization\(/)
  assert.match(view, /data-contribution-crystallization-draft/)
  assert.match(view, /heldCrystallization \? 'Crystallizing…'/)
  assert.match(view, /heldCrystallization\.entries\.map/)
  assert.doesNotMatch(view, /confirmLabel=["'{]Crystallize/,
    'the visible before/after draft is the substantive review surface')

  assert.match(facade, /entries: input\.entries\.map\(\(entry\) => \(\{ \.\.\.entry \}\)\)/)
  assert.match(facade, /const existing = heldCrystallizations\.get\(key\)[\s\S]*if \(existing\) return existing\.result/)
  assert.match(commands, /apiPost<Contribution>[\s\S]*\{ idempotencyKey \}/)
  assert.match(commands, /candidate\.id === expectedId[\s\S]*candidate\.kind === 'crystallized'/)
  assert.match(commands, /candidate\.version === event\.changesetVersion/)
  assert.match(commands, /priorVersions[\s\S]*receipt\.version[\s\S]*sort\(\(a, b\) => a\.version - b\.version\)/)
  assert.match(runtime, /createAcknowledgedActionMutationController/)

  const routeStart = routes.indexOf("r.post('/projects/:id/contributions/:cid/changeset'")
  const routeEnd = routes.indexOf("r.post('/projects/:id/contributions/:cid/envelope'", routeStart)
  assert.ok(routeStart >= 0 && routeEnd > routeStart)
  assert.match(routes.slice(routeStart, routeEnd), /idempotent\(async/)
  assert.match(routes.slice(routeStart, routeEnd), /getContributionCrystallization[\s\S]*logicalId: logicalCrystallizationId/)
  const storeStart = store.indexOf('  getContributionCrystallization(')
  const storeEnd = store.indexOf('  getContributionEffectExecution(', storeStart)
  assert.ok(storeStart >= 0 && storeEnd > storeStart)
  assert.match(store.slice(storeStart, storeEnd), /crystallizedByTenant[\s\S]*return commitMutationBatch\(\(\) => \{[\s\S]*kind: 'crystallized'[\s\S]*persist\(\)/)
  assert.match(notice, /kind="contribution-crystallization"/)
  assert.match(shell, /<ContributionCrystallizationMutationNotice \/>/)
})
