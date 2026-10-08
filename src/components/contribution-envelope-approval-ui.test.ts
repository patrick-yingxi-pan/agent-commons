/** Structural lock for acknowledgement-owned Contribution envelope approval. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

test('envelope approval is one exact shell-owned consent with a held lifecycle', () => {
  const view = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  const envelope = stripComments(read(join(ROOT, 'src', 'components', 'ContributionEnvelopeCard.tsx')))
  const commands = stripComments(read(join(ROOT, 'src', 'api', 'contributionEnvelopeApprovalCommands.ts')))
  const legacyCommands = stripComments(read(join(ROOT, 'src', 'api', 'commands.ts')))
  const facade = stripComments(read(join(ROOT, 'src', 'controller', 'contributionEnvelopeApprovalMutations.ts')))
  const runtime = stripComments(read(join(ROOT, 'src', 'controller', 'contributionEnvelopeApprovalMutationRuntime.ts')))
  const routes = stripComments(read(join(ROOT, 'server', 'routes', 'index.ts')))
  const store = stripComments(read(join(ROOT, 'server', 'store', 'index.ts')))
  const notice = stripComments(read(join(ROOT, 'src', 'components', 'ContributionEnvelopeApprovalMutationNotice.tsx')))
  const shell = stripComments(read(join(ROOT, 'src', 'components', 'ShellMutationNotices.tsx')))

  assert.doesNotMatch(legacyCommands, /export async function approveEnvelope/)
  assert.match(view, /useContributionEnvelopeApprovalStatus\(\)/)
  assert.match(view, /isContributionEnvelopeApprovalHeld\(project\.id, contributionId\)/)
  assert.match(view, /landingHeld \|\| effectExecutionHeld \|\| crystallizationHeld \|\| envelopeApprovalHeld/)
  assert.match(view, /onApprove=\{enqueueContributionEnvelopeApproval\}/)
  assert.match(envelope, /onApprove\(\{/)
  assert.match(envelope, /envelopeVersion: env\.version/)
  assert.match(envelope, /heldApproval\?\.envelopeVersion === env\.version \? 'Approving…' : 'Approve'/)
  assert.doesNotMatch(view, /confirmLabel=["'{]Approve/,
    'the envelope row is the substantive review surface')

  assert.match(facade, /const existing = heldApprovals\.get\(key\)[\s\S]*if \(existing\) return existing\.result/)
  assert.match(facade, /intentId: crypto\.randomUUID\(\)/)
  assert.match(commands, /expectedVersion: intent\.envelopeVersion/)
  assert.match(commands, /apiPost<Contribution>[\s\S]*\{ idempotencyKey, expectedSessionUserId: intent\.sourceUserId \}/)
  assert.match(commands, /event\.id === expectedId[\s\S]*event\.kind === 'envelope-approved'[\s\S]*event\.envelopeVersion === envelopeVersion/)
  assert.match(runtime, /createAcknowledgedActionMutationController/)

  const routeStart = routes.indexOf("r.post('/projects/:id/contributions/:cid/envelope/approve'")
  const routeEnd = routes.indexOf("r.post('/projects/:id/contributions/:cid/effects'", routeStart)
  assert.ok(routeStart >= 0 && routeEnd > routeStart)
  assert.match(routes.slice(routeStart, routeEnd), /async \(\{ req, res, params, body \}\)/)
  assert.match(routes.slice(routeStart, routeEnd), /expectedVersion[\s\S]*getContributionEnvelopeApproval[\s\S]*logicalId: logicalApprovalId/)
  const storeStart = store.indexOf('  getContributionEnvelopeApproval(')
  const storeEnd = store.indexOf('  getContributionEffectExecution(', storeStart)
  assert.ok(storeStart >= 0 && storeEnd > storeStart)
  assert.match(store.slice(storeStart, storeEnd), /approvedByTenant[\s\S]*return commitMutationBatch\(\(\) => \{[\s\S]*envelopeVersion: approvedVersion[\s\S]*persist\(\)/)
  assert.match(notice, /kind="contribution-envelope-approval"/)
  assert.match(shell, /<ContributionEnvelopeApprovalMutationNotice \/>/)
})
