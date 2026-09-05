/** Structural lock for acknowledgement-owned full-envelope authoring. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

test('envelope authoring holds one complete exact-base draft until durable truth', () => {
  const view = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  const commands = stripComments(read(join(ROOT, 'src', 'api', 'contributionEnvelopeProposalCommands.ts')))
  const legacyCommands = stripComments(read(join(ROOT, 'src', 'api', 'commands.ts')))
  const facade = stripComments(read(join(ROOT, 'src', 'controller', 'contributionEnvelopeProposalMutations.ts')))
  const runtime = stripComments(read(join(ROOT, 'src', 'controller', 'contributionEnvelopeProposalMutationRuntime.ts')))
  const routes = stripComments(read(join(ROOT, 'server', 'routes', 'index.ts')))
  const store = stripComments(read(join(ROOT, 'server', 'store', 'index.ts')))
  const notice = stripComments(read(join(ROOT, 'src', 'components', 'ContributionEnvelopeProposalMutationNotice.tsx')))
  const shell = stripComments(read(join(ROOT, 'src', 'components', 'ShellMutationNotices.tsx')))

  assert.doesNotMatch(legacyCommands, /export async function proposeEnvelope/)
  assert.match(view, /useContributionEnvelopeProposalStatus\(\)/)
  assert.match(view, /isContributionEnvelopeProposalHeld\(project\.id, contributionId\)/)
  assert.match(view, /envelopeApprovalHeld \|\| envelopeProposalHeld/)
  assert.match(view, /const mayPropose = c\.status === 'open' && \(env\?\.status !== 'approved' \|\| mayAct\)/,
    'every viewer may deliberate until approval; only contributor/owner may revoke approved authority')
  assert.match(view, /env\?\.lines\.map\(\(line\) => \(\{/,
    'Amend begins from the complete visible envelope rather than an append-only extra field')
  assert.match(view, /setDraftLines\(\(current\) => \[\.\.\.current, emptyEnvelopeDraftLine\(\)\]\)/)
  assert.match(view, /Remove effect \$\{index \+ 1\}/)
  assert.match(view, /Scope note \$\{index \+ 1\}/)
  assert.match(view, /data-contribution-envelope-proposal-draft/)
  assert.match(view, /enqueueContributionEnvelopeProposal\(\{[\s\S]*expectedVersion: draftBaseVersion,[\s\S]*lines,/)

  assert.match(facade, /const existing = heldProposals\.get\(key\)[\s\S]*if \(existing\) return existing\.result/)
  assert.match(facade, /lines: input\.lines\.map\(\(line\) => \(\{ \.\.\.line \}\)\)/)
  assert.match(facade, /intentId: crypto\.randomUUID\(\)/)
  assert.match(commands, /expectedVersion: intent\.expectedVersion/)
  assert.match(commands, /apiPost<Contribution>[\s\S]*\{ idempotencyKey \}/)
  assert.match(commands, /event\.id === expectedId[\s\S]*event\.kind === 'envelope-proposed'[\s\S]*event\.envelopeVersion/)
  assert.match(commands, /candidate\.envelope\?\.version === receipt\.envelopeVersion[\s\S]*candidate\.envelope\.status === 'proposed'/,
    'an older proposal acknowledgement cannot restore proposed over same-version approval')
  assert.match(runtime, /createAcknowledgedActionMutationController/)

  const routeStart = routes.indexOf("r.post('/projects/:id/contributions/:cid/envelope'")
  const routeEnd = routes.indexOf("r.post('/projects/:id/contributions/:cid/envelope/approve'", routeStart)
  assert.ok(routeStart >= 0 && routeEnd > routeStart)
  assert.match(routes.slice(routeStart, routeEnd), /expectedVersion[\s\S]*getContributionEnvelopeProposal[\s\S]*logicalId: logicalProposalId/)
  const storeStart = store.indexOf('  getContributionEnvelopeProposal(')
  const storeEnd = store.indexOf('  getContributionEnvelopeApproval(', storeStart)
  assert.ok(storeStart >= 0 && storeEnd > storeStart)
  assert.match(store.slice(storeStart, storeEnd), /proposedByTenant[\s\S]*envelopeProposalLines[\s\S]*return commitMutationBatch\(\(\) => \{[\s\S]*envelopeVersion: version[\s\S]*persist\(\)/)
  assert.match(notice, /kind="contribution-envelope-proposal"/)
  assert.match(shell, /<ContributionEnvelopeProposalMutationNotice \/>/)
})
