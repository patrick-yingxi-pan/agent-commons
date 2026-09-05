/** Structural lock for the rendered half of SYNC-12. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, stripComments, ROOT } from '../../tests/helpers/source.ts'

test('relation mutation recovery has one shared shell surface and honest initiators', () => {
  const shell = stripComments(read(join(ROOT, 'src', 'components', 'ShellMutationNotices.tsx')))
  const primitive = stripComments(read(join(ROOT, 'src', 'components', 'InlineOperationStatus.tsx')))
  const notice = stripComments(read(join(ROOT, 'src', 'components', 'RelationMutationNotice.tsx')))
  const card = stripComments(read(join(ROOT, 'src', 'components', 'RelationActionCard.tsx')))

  assert.equal((shell.match(/<RelationMutationNotice\s*\/>/g) ?? []).length, 1, 'one shell notice, not one per pane')
  assert.match(notice, /<InlineOperationStatus/)
  assert.match(notice, /label: 'Retry'/)
  assert.match(notice, /label: 'Dismiss'/)
  assert.match(notice, /z-\[60\]/, 'shell recovery remains operable above a retained modal')
  assert.match(primitive, /flex-wrap/, 'two recovery actions can wrap at the narrow tier')
  assert.ok(!notice.includes('<button'), 'recovery actions stay in the shared status primitive')
  assert.doesNotMatch(card, /recordRelationVerdict|resolveMessageRelation/,
    'the proposal card cannot split effect execution from verdict recording')
})

test('relation proposal consent is one exact shell-owned decision with addressed recovery', () => {
  const card = stripComments(read(join(ROOT, 'src', 'components', 'RelationActionCard.tsx')))
  const commands = stripComments(read(join(ROOT, 'src', 'api', 'relationActionDecisionCommands.ts')))
  const legacyCommands = stripComments(read(join(ROOT, 'src', 'api', 'commands.ts')))
  const facade = stripComments(read(join(ROOT, 'src', 'controller', 'relationActionDecisionMutations.ts')))
  const runtime = stripComments(read(join(ROOT, 'src', 'controller', 'relationActionDecisionMutationRuntime.ts')))
  const routes = stripComments(read(join(ROOT, 'server', 'routes', 'index.ts')))
  const store = stripComments(read(join(ROOT, 'server', 'store', 'index.ts')))
  const notice = stripComments(read(join(ROOT, 'src', 'components', 'RelationActionDecisionMutationNotice.tsx')))
  const sharedNotice = stripComments(read(join(ROOT, 'src', 'components', 'RevisionedMutationNotice.tsx')))
  const shell = stripComments(read(join(ROOT, 'src', 'components', 'ShellMutationNotices.tsx')))

  assert.doesNotMatch(legacyCommands, /export async function resolveMessageRelation/,
    'there is no best-effort component command left to bypass the acknowledgement owner')
  assert.match(card, /useRelationActionDecisionStatus\(\)/)
  assert.match(card, /heldRelationActionDecisionIntent\(sessionId, messageId, key\)/)
  assert.match(card, /enqueueRelationActionDecision\(\{ tenantId, sessionId, messageId, operation, verdict \}\)/)
  assert.match(card, /const isDone =\s*!held &&/,
    'ambient graph or verdict state cannot hide an uncertain local consent decision')
  assert.match(card, /data-relation-action-decision=\{held \? 'held' : 'ready'\}/)
  assert.match(card, /data-relation-action-key=\{key\}/,
    'the row retains one content-independent rendered identity after its applied copy changes')
  assert.match(card, /held\?\.verdict === 'confirmed'[\s\S]*Applying…/)
  assert.match(card, /held\?\.verdict === 'skipped' \? 'Recording…' : 'Not now'/)
  assert.match(card, /held && decisionMutation\.activeResourceId === resourceId[\s\S]*decisionMutation\.error/,
    'a shell-owned failure still explains itself beside the exact source card')

  assert.match(commands, /apiPost<ResolveMessageRelationResponse>[\s\S]*\{ idempotencyKey \}/)
  assert.match(commands, /response\.decisionId === expectedId/)
  assert.match(commands, /apiGet<Session>\(paths\.session\(intent\.sessionId\)\)/,
    'reconciliation reads the complete authoritative transcript for an older unresolved card')
  assert.match(commands, /message\.relationDecisionIds\?\.\[intent\.operationKey\] !== expectedId/)
  assert.match(facade, /const existing = heldDecisions\.get\(key\)[\s\S]*existing\.intent\.verdict === input\.verdict/)
  assert.match(facade, /intentId: crypto\.randomUUID\(\)/)
  assert.match(facade, /onAccountSwitch\([\s\S]*heldDecisions\.clear\(\)/)
  assert.match(runtime, /createAcknowledgedActionMutationController/)
  assert.match(runtime, /message\.id === intent\.messageId[\s\S]*relationsResolved:[\s\S]*relationDecisionIds:/,
    'late acknowledgement merges only the addressed message decision fields')
  assert.match(runtime, /addContextToLive\(withDecision, added\)/,
    'an acknowledged context attachment also reconciles its addressed live panel')
  assert.match(runtime, /mintIdempotencyKey: \(intent\) => intent\.intentId/)

  const routeStart = routes.indexOf("r.intrinsicPost('/sessions/:id/messages/:messageId/relations'")
  const routeEnd = routes.indexOf("r.uiFormGet('/sessions/:id/turns/:turnId/stream'", routeStart)
  assert.ok(routeStart >= 0 && routeEnd > routeStart)
  const route = routes.slice(routeStart, routeEnd)
  assert.match(route, /sessionOwnedBy\(session, who\.tenant\.id\)/,
    'read sharing never widens proposal consent')
  assert.match(route, /Object\.keys\(input\)\.some/,
    'the first-party route accepts no client-supplied operation or receipt')
  assert.match(route, /relationActionDecisionId\([\s\S]*who\.tenant\.id[\s\S]*params\.messageId[\s\S]*key[\s\S]*idempotencyKey/)
  assert.match(route, /getMessageRelationDecision\([\s\S]*decisionId[\s\S]*verdict/)
  assert.match(route, /decideMessageRelation\([\s\S]*decisionId[\s\S]*who\.tenant\.id/)

  const storeStart = store.indexOf('  getMessageRelationDecision(')
  const storeEnd = store.indexOf('  setSessionAgent(', storeStart)
  assert.ok(storeStart >= 0 && storeEnd > storeStart)
  const storeSlice = store.slice(storeStart, storeEnd)
  assert.match(storeSlice, /representedId !== decisionId \|\| representedVerdict !== verdict/)
  assert.match(storeSlice, /return commitMutationBatch\(\(\) => \{[\s\S]*applyRelationOp\(operation, tenantId\)[\s\S]*relationDecisionIds[\s\S]*persist\(\)/,
    'effect, exact verdict receipt, publication, and persistence share one fail-closed commit')
  assert.match(notice, /kind="relation-action-decision"/)
  assert.match(sharedNotice, /data-relation-action-decision=/)
  assert.match(shell, /<RelationActionDecisionMutationNotice \/>/)
})
