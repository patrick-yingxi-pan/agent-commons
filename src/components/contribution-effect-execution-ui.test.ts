/** Structural lock for acknowledgement-owned Contribution effect execution. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

test('Contribution effect execution is one exact shell-owned act with a held lifecycle', () => {
  const view = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  const commands = stripComments(read(join(ROOT, 'src', 'api', 'contributionEffectExecutionCommands.ts')))
  const legacyCommands = stripComments(read(join(ROOT, 'src', 'api', 'commands.ts')))
  const facade = stripComments(read(join(ROOT, 'src', 'controller', 'contributionEffectExecutionMutations.ts')))
  const runtime = stripComments(read(join(ROOT, 'src', 'controller', 'contributionEffectExecutionMutationRuntime.ts')))
  const routes = stripComments(read(join(ROOT, 'server', 'routes', 'index.ts')))
  const store = stripComments(read(join(ROOT, 'server', 'store', 'index.ts')))
  const notice = stripComments(read(join(ROOT, 'src', 'components', 'ContributionEffectExecutionMutationNotice.tsx')))
  const shell = stripComments(read(join(ROOT, 'src', 'components', 'ShellMutationNotices.tsx')))

  assert.doesNotMatch(legacyCommands, /export async function runEnvelopeEffect/)
  assert.match(view, /useContributionEffectExecutionStatus\(\)/)
  assert.match(view, /isContributionEffectExecutionHeld\(project\.id, contributionId\)/)
  assert.match(view, /const lifecycleHeld = landingHeld \|\| effectExecutionHeld/)
  assert.match(view, /enqueueContributionEffectExecution\(/)
  assert.match(view, /heldExecution\?\.lineId === l\.id \? 'Running…' : 'Run'/)
  assert.match(view, /ChangesetCard project=\{project\} c=\{c\} lifecycleHeld=\{lifecycleHeld\}/)
  assert.match(view, /EnvelopeCard project=\{project\} c=\{c\} lifecycleHeld=\{lifecycleHeld\}/)
  assert.doesNotMatch(view, /confirmLabel=["'{]Run/,
    'the envelope row already presents the approved type, target, harness, and cardinality')

  assert.match(facade, /const existing = heldExecutions\.get\(key\)[\s\S]*if \(existing\) return existing\.result/)
  assert.match(facade, /intentId: crypto\.randomUUID\(\)/)
  assert.match(commands, /apiPost<Contribution>[\s\S]*\{ idempotencyKey \}/)
  assert.match(commands, /event\.id === expectedId[\s\S]*event\.lineId === intent\.lineId/)
  assert.match(commands, /receipt\?\.kind === 'effect-executed'/,
    'a recorded refusal updates truth but cannot masquerade as successful execution')
  assert.match(runtime, /createAcknowledgedActionMutationController/)

  const routeStart = routes.indexOf("r.post('/projects/:id/contributions/:cid/effects'")
  const routeEnd = routes.indexOf("r.post('/projects/:id/contributions/:cid/land'", routeStart)
  assert.ok(routeStart >= 0 && routeEnd > routeStart)
  assert.match(routes.slice(routeStart, routeEnd), /idempotent\(async/)
  assert.match(routes.slice(routeStart, routeEnd), /getContributionEffectExecution[\s\S]*logicalId: logicalExecutionId/)
  const storeStart = store.indexOf('  getContributionEffectExecution(')
  const storeEnd = store.indexOf('  createA2aPeer(', storeStart)
  assert.ok(storeStart >= 0 && storeEnd > storeStart)
  assert.match(store.slice(storeStart, storeEnd), /effectByTenant[\s\S]*return commitMutationBatch\(\(\) => \{[\s\S]*effect-executed[\s\S]*persist\(\)/)
  assert.match(notice, /kind="contribution-effect"/)
  assert.match(shell, /<ContributionEffectExecutionMutationNotice \/>/)
})
