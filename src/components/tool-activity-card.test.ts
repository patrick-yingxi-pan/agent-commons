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

test('external MCP calls always show exact one-shot approval identity', () => {
  assert.match(source, /const mcp = a\.mcp/)
  assert.match(source, /mcp\.toolName/,
    'the reviewed raw tool name is displayed instead of a routing-name derivation')
  assert.match(source, /externalMcp && \(a\.status === 'proposed' \|\| held !== null\)/,
    'every external MCP call is approval-gated independently of read/action annotations')
  assert.match(source, /Approval applies only to this call/)
  assert.match(source, /confirm: 'Run tool'/)
})

test('external MCP results are inert and uncertainty cannot imply success or replay', () => {
  assert.match(source, /function McpResultBody/)
  assert.match(source, /JSON\.stringify\(result\.structuredContent, null, 2\)/)
  assert.match(source, /Media omitted/)
  assert.doesNotMatch(source, /dangerouslySetInnerHTML|<img|<audio|href=\{.*mcp/i)
  assert.match(source, /displayStatus === 'uncertain'/)
  assert.match(source, /may have run, but no result was confirmed/)
  assert.match(source, /won.t be retried automatically/)
  assert.doesNotMatch(source, /uncertain[\s\S]{0,500}Retry/,
    'a post-submission uncertain execution never offers replay from the card')
  assert.match(source, /a\.mcpResult\?\.isError/,
    'a server-reported tool error cannot receive the successful result face')
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
  assert.match(card, /enqueueToolActivityDecision\(\{ tenantId, sourceUserId, sessionId, activityId: a\.id, decision \}\)/)
  assert.match(card, /a\.status === 'proposed' \|\| held !== null/,
    'ambient terminal state cannot hide an uncertain local consent decision')
  assert.match(card, /data-tool-activity-decision=\{held \? 'held' : 'ready'\}/)
  assert.match(card, /held\?\.decision === 'confirm'[\s\S]*pending/)
  assert.match(card, /held\?\.decision === 'decline' \? 'Declining…' : 'Decline'/)
  assert.match(card, /mutation\.activeResourceId === resourceId \? mutation\.error : null/,
    'a shell-owned failure still explains itself beside the exact source card')

  assert.match(commands, /apiPost<ToolActivity>[\s\S]*\{ idempotencyKey, expectedSessionUserId: intent\.sourceUserId \}/,
    'the approval POST names the frozen first-party session principal')
  assert.match(commands, /const issuedGeneration = accountGeneration\(\)[\s\S]*await toolActivityDecisionId[\s\S]*assertScope\(intent, issuedGeneration\)/,
    'the account scope is rechecked after asynchronous receipt hashing and before submission')
  assert.match(commands, /activity\.decisionId === expectedId[\s\S]*expectedDecisionStatus\(activity, intent\.decision\)/)
  assert.match(commands, /activity\.kind === 'action'/,
    'an MCP marker alone cannot turn a malformed read row into a consent acknowledgement')
  assert.match(commands, /confirmedMcpStatuses[\s\S]*'running'[\s\S]*'done'[\s\S]*'failed'[\s\S]*'uncertain'/,
    'an exact external confirmation receipt may settle before or after the one-shot call')
  assert.match(commands, /decision === 'decline'[\s\S]*activity\.status === 'declined'/,
    'decline never reconciles against an execution-shaped terminal state')
  assert.match(commands, /apiGet<Session>\(paths\.session\(intent\.sessionId\)\)/,
    'reconciliation reads the complete authoritative transcript for an older unresolved card')
  assert.match(commands, /session\.compactedMessages[\s\S]*candidate\.status === 'done'[\s\S]*candidate\.status === 'failed'[\s\S]*candidate\.status === 'uncertain'[\s\S]*candidate\.status === 'declined'/,
    'archive reconciliation accepts terminal receipts without reopening proposed or running consent')
  assert.match(facade, /const existing = heldDecisions\.get\(key\)[\s\S]*existing\.intent\.decision === input\.decision/)
  assert.match(facade, /intentId: crypto\.randomUUID\(\)/)
  assert.match(card, /sourceUserId = identity\?\.via === 'session' \? identity\.user\.id : null/)
  assert.match(facade, /createRetryableRuntimeLoader<Runtime>/,
    'a failed lazy import can be retried instead of being cached forever')
  assert.match(facade, /Couldn.t load the tool decision controller\. Retry safely or Dismiss\./,
    'lazy-load failure remains a visible held decision')
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
  assert.match(storeSlice, /const exact = candidates\.filter[\s\S]*exact\.length > 1[\s\S]*activity\.status === 'running'[\s\S]*activity\.status === 'uncertain'/,
    'exact receipt identity wins across active and archived rows without accepting ambiguous duplicates')
  assert.match(storeSlice, /return commitMutationBatch\(\(\) => \{[\s\S]*act\.decisionId = options\.logicalId[\s\S]*recordAudit[\s\S]*persist\(\)[\s\S]*emit\(/,
    'receipt, terminal status, audit, persistence, and publication share one fail-closed commit')
  assert.match(notice, /kind="tool-activity-decision"/)
  assert.match(sharedNotice, /data-tool-activity-decision=/)
  assert.match(shell, /<ToolActivityDecisionMutationNotice \/>/)
})
