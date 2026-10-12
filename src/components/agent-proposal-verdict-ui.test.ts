/** Structural lock for acknowledgement-owned Agent proposal decisions. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

test('Agent proposal verdicts are exact shell-owned actions with monotonic recovery', () => {
  const view = stripComments(read(join(ROOT, 'src', 'components', 'AgentProposalsReviewDialog.tsx')))
  const commands = stripComments(read(join(ROOT, 'src', 'api', 'agentProposalVerdictCommands.ts')))
  const legacyCommands = stripComments(read(join(ROOT, 'src', 'api', 'commands.ts')))
  const facade = stripComments(read(join(ROOT, 'src', 'controller', 'agentProposalVerdictMutations.ts')))
  const runtime = stripComments(read(join(ROOT, 'src', 'controller', 'agentProposalVerdictMutationRuntime.ts')))
  const routes = stripComments(read(join(ROOT, 'server', 'routes', 'index.ts')))
  const store = stripComments(read(join(ROOT, 'server', 'store', 'index.ts')))
  const notice = stripComments(read(join(ROOT, 'src', 'components', 'AgentProposalVerdictMutationNotice.tsx')))
  const sharedNotice = stripComments(read(join(ROOT, 'src', 'components', 'RevisionedMutationNotice.tsx')))
  const shell = stripComments(read(join(ROOT, 'src', 'components', 'ShellMutationNotices.tsx')))

  assert.doesNotMatch(legacyCommands, /export async function resolveAgentProposal/,
    'there is no best-effort verdict command for future callers to bypass through')
  assert.match(view, /useAgentProposalVerdictStatus\(\)/)
  assert.match(view, /heldAgentProposalVerdictIntent\(agent\.id, proposal\.id\)/)
  assert.match(view, /enqueueAgentProposalVerdict\(\{ tenantId, agentId: agent\.id, proposalId, action \}\)/)
  assert.match(view, /data-agent-proposal-verdict=\{heldVerdict \? 'held' : 'ready'\}/)
  assert.match(view, /proposal\.status === 'open' \|\| heldVerdict/,
    'an acknowledgement-lost verdict remains visible even after ambient terminal truth arrives')
  assert.match(view, /heldVerdict\?\.action === 'merge' \? 'Merging…' : 'Merge'/)
  assert.match(view, /heldVerdict\?\.action === 'decline' \? 'Declining…' : 'Decline'/)

  assert.match(commands, /apiPost<AgentChangeProposal>[\s\S]*\{ idempotencyKey \}/)
  assert.match(commands, /proposal\.verdictId === expectedId[\s\S]*proposal\.status ===/)
  assert.match(commands, /responseNote[\s\S]*intent\.note/)
  assert.match(commands, /\.\.\.candidate,[\s\S]*status: proposal\.status,[\s\S]*verdictId: proposal\.verdictId/,
    'a delayed acknowledgement merges terminal proof instead of replacing current comments or checks')
  assert.match(commands, /apiGet<AgentChangeProposal\[]>\(paths\.agentProposals/)
  assert.match(commands, /setData\(keys\.agentProposals[\s\S]*if \(proposal && represented\)[\s\S]*rememberVerdict/,
    'cold-cache reconciliation still refreshes the changed Agent and directory projections')
  assert.match(facade, /const existing = heldVerdicts\.get\(key\)[\s\S]*existing\.intent\.action === input\.action/)
  assert.match(facade, /intentId: crypto\.randomUUID\(\)/)
  assert.match(facade, /onAccountSwitch\([\s\S]*heldVerdicts\.clear\(\)/)
  assert.match(runtime, /createAcknowledgedActionMutationController/)
  assert.match(runtime, /mintIdempotencyKey: \(intent\) => intent\.intentId/)

  const routeStart = routes.indexOf("r.post('/agents/:id/proposals/:pid/merge'")
  const routeEnd = routes.indexOf("r.get('/projects/:id/watch'", routeStart)
  assert.ok(routeStart >= 0 && routeEnd > routeStart)
  const route = routes.slice(routeStart, routeEnd)
  assert.match(route, /agentProposalVerdictId\(who\.tenant\.id, params\.id, params\.pid, idempotencyKey\)/)
  assert.match(route, /resolveAgentProposal\([\s\S]*\{ logicalId: logicalVerdictId \}/)
  assert.match(route, /input\?\.note !== undefined && typeof input\.note !== 'string'/)

  const storeStart = store.indexOf('  getAgentProposalVerdict(')
  const storeEnd = store.indexOf('  ownerProfileCore(', storeStart)
  assert.ok(storeStart >= 0 && storeEnd > storeStart)
  const storeSlice = store.slice(storeStart, storeEnd)
  assert.match(storeSlice, /proposal\.verdictByTenant !== tenantId[\s\S]*proposal\.status !== expectedStatus[\s\S]*responseNote/)
  assert.match(storeSlice, /return commitMutationBatch\(\(\) => \{[\s\S]*proposal\.verdictId = options\.logicalId[\s\S]*WORKER_AGENTS\.set[\s\S]*notifyTenants[\s\S]*emit\([\s\S]*persist\(\)/,
    'receipt, definition change, bell, signals, and persistence share one fail-closed commit')
  assert.match(notice, /kind="agent-proposal-verdict"/)
  assert.match(sharedNotice, /data-agent-proposal-verdict=/)
  assert.match(shell, /<AgentProposalVerdictMutationNotice \/>/)
})
