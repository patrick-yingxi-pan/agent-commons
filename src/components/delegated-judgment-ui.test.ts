/** Structural lock for acknowledgement-owned exact delegated judgment. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

test('delegated judgment is one exact shell-owned act with an atomic receipt and held lifecycle', () => {
  const view = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  const commands = stripComments(read(join(ROOT, 'src', 'api', 'delegatedJudgmentCommands.ts')))
  const legacyCommands = stripComments(read(join(ROOT, 'src', 'api', 'commands.ts')))
  const facade = stripComments(read(join(ROOT, 'src', 'controller', 'delegatedJudgmentMutations.ts')))
  const runtime = stripComments(read(join(ROOT, 'src', 'controller', 'delegatedJudgmentMutationRuntime.ts')))
  const routes = stripComments(read(join(ROOT, 'server', 'routes', 'index.ts')))
  const store = stripComments(read(join(ROOT, 'server', 'store', 'index.ts')))
  const notice = stripComments(read(join(ROOT, 'src', 'components', 'DelegatedJudgmentMutationNotice.tsx')))
  const shell = stripComments(read(join(ROOT, 'src', 'components', 'ShellMutationNotices.tsx')))

  assert.doesNotMatch(legacyCommands, /export async function runDelegation/)
  assert.match(view, /useDelegatedJudgmentStatus\(\)/)
  assert.match(view, /heldDelegatedJudgmentIntent\(project\.id, contributionId\)/)
  assert.match(view, /const lifecycleHeld =[^\n]*delegatedJudgmentHeld/,
    'delegated uncertainty excludes every competing lifecycle act')
  assert.match(view, /heldDelegatedJudgment[\s\S]*delegationAction/,
    'returning to the Contribution reconstructs the exact held delegate action')
  assert.match(view, /enqueueDelegatedJudgment\(\{[\s\S]*delegationId: delegation\.id[\s\S]*actKind: delegation\.actKind/)
  assert.match(view, /`Asking \$\{heldDelegatedJudgment\.agentLabel\}…`/)
  assert.match(view, /disabled=\{commentHeld\}/,
    'orthogonal timeline commentary remains available while judgment is uncertain')

  assert.match(facade, /const existing = heldJudgments\.get\(key\)[\s\S]*if \(existing\) return existing\.result/)
  assert.match(facade, /intentId: crypto\.randomUUID\(\)/)
  assert.match(facade, /onAccountSwitch\([\s\S]*heldJudgments\.clear\(\)/)
  assert.match(commands, /apiPost<Contribution>[\s\S]*\{ idempotencyKey \}/)
  assert.match(commands, /event\.id === expectedId[\s\S]*event\.delegationId === delegationId[\s\S]*delegated-decision/)
  assert.match(commands, /candidate\.envelope\?\.version === intent\.envelopeVersion[\s\S]*contribution\.envelope\?\.version === intent\.envelopeVersion/,
    'a delayed delegated approval cannot replace a later envelope')
  assert.match(runtime, /createAcknowledgedActionMutationController/)
  assert.match(runtime, /mintIdempotencyKey: \(intent\) => intent\.intentId/)

  const routeStart = routes.indexOf("r.post('/projects/:id/contributions/:cid/delegated/:did'")
  const routeEnd = routes.indexOf("r.post('/projects/:id/contributions/:cid/changeset'", routeStart)
  assert.ok(routeStart >= 0 && routeEnd > routeStart)
  const route = routes.slice(routeStart, routeEnd)
  assert.match(route, /idempotent\(\(\{ req, res, params \}\) =>/)
  assert.match(route, /delegatedJudgmentId[\s\S]*getDelegatedJudgment[\s\S]*runDelegation/,
    'durable replay is checked before mutable applicability')

  const receiptStart = store.indexOf('  getDelegatedJudgment(')
  const runStart = store.indexOf('  runDelegation(', receiptStart)
  const runEnd = store.indexOf('  getContributionReview(', runStart)
  assert.ok(receiptStart >= 0 && runStart > receiptStart && runEnd > runStart)
  assert.match(store.slice(receiptStart, runStart), /event\.delegationId !== delegationId[\s\S]*event\.delegatedByTenant !== tenantId/)
  assert.match(store.slice(runStart, runEnd), /return commitMutationBatch\(\(\) => \{[\s\S]*this\.approveEnvelope[\s\S]*pushEvent\('delegated-decision'/,
    'the delegated effect and exact audit receipt share one durable commit')
  assert.match(store, /delegatedByTenant,[\s\S]*\.\.\.pub/,
    'private retry authority is stripped from the public timeline')
  assert.match(notice, /kind="delegated-judgment"/)
  assert.match(shell, /<DelegatedJudgmentMutationNotice \/>/)
})
