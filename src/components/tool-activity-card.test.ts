import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { ROOT, read, stripComments } from '../../tests/helpers/source.ts'

const source = stripComments(read(join(ROOT, 'src', 'components', 'ToolActivityCard.tsx')))

test('connector runtime failure has an explicit non-success face and recovery explanation', () => {
  assert.ok(source.includes("const failed = displayStatus === 'failed'"), 'failed is a first-class rendered state')
  assert.ok(source.includes('<AlertCircle size={14} />'), 'failure cannot reuse the neutral or completed icon')
  assert.ok(source.includes('a.failure?.retryable'), 'stable retry semantics choose the recovery explanation')
  assert.ok(source.includes('Connector setup needs attention before this can run.'), 'terminal setup work is explicit')
})

test('connector consent previews the exact persisted arguments', () => {
  assert.ok(source.includes('pending && !a.op && a.input'), 'connector proposals own a distinct argument preview')
  assert.ok(source.includes('JSON.stringify(a.input, null, 1)'), 'the preview reads the persisted input verbatim')
})

test('tool consent is one exact shell-owned decision with monotonic conversation recovery', () => {
  const card = stripComments(read(join(ROOT, 'src', 'components', 'ToolActivityCard.tsx')))
  const commands = stripComments(read(join(ROOT, 'src', 'api', 'toolActivityDecisionCommands.ts')))
  const legacyCommands = stripComments(read(join(ROOT, 'src', 'api', 'commands.ts')))
  const facade = stripComments(read(join(ROOT, 'src', 'controller', 'toolActivityDecisionMutations.ts')))
  const runtime = stripComments(read(join(ROOT, 'src', 'controller', 'toolActivityDecisionMutationRuntime.ts')))
  const routes = stripComments(read(join(ROOT, 'server', 'routes', 'index.ts')))
  const store = stripComments(read(join(ROOT, 'server', 'store', 'index.ts')))
  const notice = stripComments(read(join(ROOT, 'src', 'components', 'ToolActivityDecisionMutationNotice.tsx')))
  const sharedNotice = stripComments(read(join(ROOT, 'src', 'components', 'RevisionedMutationNotice.tsx')))
  const shell = stripComments(read(join(ROOT, 'src', 'components', 'ShellMutationNotices.tsx')))

  assert.doesNotMatch(legacyCommands, /export async function resolveToolActivity/,
    'there is no best-effort component command left to bypass the acknowledgement owner')
  assert.match(card, /useToolActivityDecisionStatus\(\)/)
  assert.match(card, /heldToolActivityDecisionIntent\(sessionId, a\.id\)/)
  assert.match(card, /enqueueToolActivityDecision\(\{ tenantId, sessionId, activityId: a\.id, decision \}\)/)
  assert.match(card, /a\.status === 'proposed' \|\| held !== null/,
    'ambient terminal state cannot hide an uncertain local consent decision')
  assert.match(card, /data-tool-activity-decision=\{held \? 'held' : 'ready'\}/)
  assert.match(card, /held\?\.decision === 'confirm'[\s\S]*pending/)
  assert.match(card, /held\?\.decision === 'decline' \? 'Declining…' : 'Decline'/)
  assert.match(card, /mutation\.activeResourceId === resourceId \? mutation\.error : null/,
    'a shell-owned failure still explains itself beside the exact source card')

  assert.match(commands, /apiPost<ToolActivity>[\s\S]*\{ idempotencyKey \}/)
  assert.match(commands, /activity\.decisionId === expectedId[\s\S]*activity\.status === expectedStatus/)
  assert.match(commands, /apiGet<Session>\(paths\.session\(intent\.sessionId\)\)/,
    'reconciliation reads the complete authoritative transcript for an older unresolved card')
  assert.match(facade, /const existing = heldDecisions\.get\(key\)[\s\S]*existing\.intent\.decision === input\.decision/)
  assert.match(facade, /intentId: crypto\.randomUUID\(\)/)
  assert.match(facade, /onAccountSwitch\([\s\S]*heldDecisions\.clear\(\)/)
  assert.match(runtime, /createAcknowledgedActionMutationController/)
  assert.match(runtime, /candidate\.id === activity\.id \? activity : candidate/,
    'late acknowledgement merges one activity rather than replacing conversation history')
  assert.match(runtime, /mintIdempotencyKey: \(intent\) => intent\.intentId/)

  const routeStart = routes.indexOf("r.intrinsicPost('/sessions/:id/tool-activities/:activityId'")
  const routeEnd = routes.indexOf("r.post('/sessions/:id/compact'", routeStart)
  assert.ok(routeStart >= 0 && routeEnd > routeStart)
  const route = routes.slice(routeStart, routeEnd)
  assert.match(route, /sessionOwnedBy\(session, who\.tenant\.id\)/,
    'read sharing never widens effect consent')
  assert.match(route, /toolActivityDecisionId\(who\.tenant\.id, params\.id, params\.activityId, idempotencyKey\)/)
  assert.match(route, /getToolActivityDecision\([\s\S]*logicalDecisionId[\s\S]*decision/)
  assert.match(route, /pending\.op\?\.method === 'DELETE'[\s\S]*pending\.op\.path === `\/sessions\/\$\{encodeURIComponent\(params\.id\)\}`/,
    'a consent record cannot authorize its own erasure')
  assert.match(route, /apiDispatch\([\s\S]*pending\.op\.method[\s\S]*\{ idempotencyKey: logicalDecisionId \}/,
    'the stable derived receipt crosses into the generated API mutation')
  assert.match(route, /finally \{[\s\S]*if \(claimed\) store\.releaseToolActivity/,
    'an unexpected runtime failure cannot wedge the action claim')

  const storeStart = store.indexOf('  getToolActivityDecision(')
  const storeEnd = store.indexOf('  sessionWorkspace(', storeStart)
  assert.ok(storeStart >= 0 && storeEnd > storeStart)
  const storeSlice = store.slice(storeStart, storeEnd)
  assert.match(storeSlice, /activity\.decisionId !== decisionId[\s\S]*expectedStatus/)
  assert.match(storeSlice, /return commitMutationBatch\(\(\) => \{[\s\S]*act\.decisionId = options\.logicalId[\s\S]*recordAudit[\s\S]*persist\(\)[\s\S]*emit\(/,
    'receipt, terminal status, audit, persistence, and publication share one fail-closed commit')
  assert.match(notice, /kind="tool-activity-decision"/)
  assert.match(sharedNotice, /data-tool-activity-decision=/)
  assert.match(shell, /<ToolActivityDecisionMutationNotice \/>/)
})
