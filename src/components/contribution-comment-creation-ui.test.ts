import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

test('Contribution comments are one held, exactly reconciled action independent of lifecycle acts', () => {
  const view = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  const commands = stripComments(read(join(ROOT, 'src', 'api', 'contributionCommentCreationCommands.ts')))
  const legacyCommands = stripComments(read(join(ROOT, 'src', 'api', 'commands.ts')))
  const facade = stripComments(read(join(ROOT, 'src', 'controller', 'contributionCommentCreationMutations.ts')))
  const runtime = stripComments(read(join(ROOT, 'src', 'controller', 'contributionCommentCreationMutationRuntime.ts')))
  const routes = stripComments(read(join(ROOT, 'server', 'routes', 'index.ts')))
  const store = stripComments(read(join(ROOT, 'server', 'store', 'index.ts')))
  const notice = stripComments(read(join(ROOT, 'src', 'components', 'ContributionCommentCreationMutationNotice.tsx')))
  const shell = stripComments(read(join(ROOT, 'src', 'components', 'ShellMutationNotices.tsx')))

  assert.doesNotMatch(legacyCommands, /export async function noteContribution/,
    'there is no best-effort comment door for future callers to bypass through')
  assert.match(view, /useContributionCommentCreationStatus\(\)/)
  assert.match(view, /heldContributionCommentIntent\(project\.id, contributionId\)/)
  assert.match(view, /if \(!heldComment\) return\s+setDraft\(heldComment\.body\)/,
    'returning to the Contribution restores the exact held draft')
  assert.match(view, /data-contribution-comment-form/)
  assert.match(view, /maxLength=\{CONTRIBUTION_FIELD_MAX\}/)
  assert.match(view, /aria-busy=\{commentHeld \|\| undefined\}/)
  assert.match(view, /disabled=\{commentHeld\}/)
  assert.match(view, /enqueueContributionCommentCreation\(\{[\s\S]*tenantId: me\.tenant\.id,[\s\S]*projectId: project\.id,[\s\S]*contributionId: c\.id,[\s\S]*body: draft/)
  assert.match(view, /if \(outcome === 'applied'\) setDraft\(''\)/,
    'the composer clears only after represented truth')
  assert.match(view, /const lifecycleHeld = landingHeld \|\| effectExecutionHeld \|\| crystallizationHeld \|\| envelopeApprovalHeld \|\| envelopeProposalHeld/)
  assert.doesNotMatch(view, /const lifecycleHeld =[^\n]*commentHeld/,
    'a held comment does not disable an independent landing or envelope act')

  assert.match(commands, /apiPost<Contribution>[\s\S]*\{ idempotencyKey \}/)
  assert.match(commands, /event\.id === expectedId &&[\s\S]*event\.kind === 'note' &&[\s\S]*event\.body === intent\.body/)
  assert.match(commands, /events: \[\.\.\.candidate\.events, receipt\]\.sort/,
    'reconciliation appends the exact receipt instead of replacing newer Contribution truth')
  assert.doesNotMatch(commands, /return contribution\s*\n/,
    'a delayed response cannot replace the whole cached Contribution')
  assert.match(commands, /apiGet<Contribution\[]>\(paths\.contributions/)
  assert.match(facade, /const existing = heldComments\.get\(key\)[\s\S]*if \(existing\) return existing\.result/,
    'repeat activation on one Contribution shares the logical comment')
  assert.match(facade, /trim\(\)\.slice\(0, CONTRIBUTION_FIELD_MAX\)/)
  assert.match(facade, /intentId: crypto\.randomUUID\(\)/)
  assert.match(facade, /onAccountSwitch\([\s\S]*heldComments\.clear\(\)/)
  assert.match(runtime, /createAcknowledgedActionMutationController/)
  assert.match(runtime, /mintIdempotencyKey: \(intent\) => intent\.intentId/)

  const routeStart = routes.indexOf("r.post('/projects/:id/contributions/:cid/comments'")
  const routeEnd = routes.indexOf("r.get('/projects/:id/attention'", routeStart)
  assert.ok(routeStart >= 0 && routeEnd > routeStart)
  const route = routes.slice(routeStart, routeEnd)
  assert.match(route, /contributionCommentCreationId\(who\.tenant\.id, params\.id, params\.cid, idempotencyKey\)/)
  assert.match(route, /getContributionCommentCreation\([\s\S]*if \(typeof represented === 'object'\) return sendJson/)
  assert.match(route, /noteContribution\([\s\S]*\{ logicalId: logicalCommentId \}/)

  const storeStart = store.indexOf('  getContributionCommentCreation(')
  const storeEnd = store.indexOf('  getContributionLanding(', storeStart)
  assert.ok(storeStart >= 0 && storeEnd > storeStart)
  const storeSlice = store.slice(storeStart, storeEnd)
  assert.match(storeSlice, /event\.notedByTenant !== tenantId/)
  assert.match(storeSlice, /event\.body !== normalizedBody/)
  assert.match(storeSlice, /return commitMutationBatch\(\(\) => \{[\s\S]*events\.push\([\s\S]*notedByTenant: tenantId[\s\S]*emit\([\s\S]*persist\(\)/,
    'the receipt, event, signal, and persistence share one commit')
  assert.match(notice, /kind="contribution-comment-create"/)
  assert.match(shell, /<ContributionCommentCreationMutationNotice \/>/)
})
