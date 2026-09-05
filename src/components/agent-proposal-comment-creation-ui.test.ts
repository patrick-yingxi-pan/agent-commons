import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

test('Agent proposal comments are one exact held action across both thread projections', () => {
  const view = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  const commands = stripComments(read(join(ROOT, 'src', 'api', 'agentProposalCommentCreationCommands.ts')))
  const legacyCommands = stripComments(read(join(ROOT, 'src', 'api', 'commands.ts')))
  const facade = stripComments(read(join(ROOT, 'src', 'controller', 'agentProposalCommentCreationMutations.ts')))
  const runtime = stripComments(read(join(ROOT, 'src', 'controller', 'agentProposalCommentCreationMutationRuntime.ts')))
  const routes = stripComments(read(join(ROOT, 'server', 'routes', 'index.ts')))
  const store = stripComments(read(join(ROOT, 'server', 'store', 'index.ts')))
  const notice = stripComments(read(join(ROOT, 'src', 'components', 'AgentProposalCommentCreationMutationNotice.tsx')))
  const shell = stripComments(read(join(ROOT, 'src', 'components', 'ShellMutationNotices.tsx')))

  assert.doesNotMatch(legacyCommands, /export async function commentOnAgentProposal/,
    'there is no best-effort comment door for future callers to bypass through')
  assert.match(view, /useAgentProposalCommentCreationStatus\(\)/)
  assert.match(view, /heldAgentProposalCommentIntent\(agentId, proposal\.id\)/)
  assert.match(view, /if \(!heldComment\) return[\s\S]*setDraft\(heldComment\.body\)/,
    'returning to either projection restores the exact held draft')
  assert.match(view, /data-agent-proposal-comment-form/)
  assert.match(view, /maxLength=\{WORK_ITEM_COMMENT_MAX\}/)
  assert.match(view, /aria-busy=\{commentHeld \|\| undefined\}/)
  assert.match(view, /disabled=\{commentHeld\}/)
  assert.match(view, /enqueueAgentProposalCommentCreation\(\{[\s\S]*tenantId: me\.tenant\.id,[\s\S]*agentId,[\s\S]*proposalId: proposal\.id,[\s\S]*body: draft/)
  assert.match(view, /if \(outcome === 'applied'\) setDraft\(''\)/,
    'the composer clears only after represented truth')
  assert.match(view, /\(openForComments \|\| commentHeld\)/,
    'a held authored draft stays visible if a concurrent verdict closes the proposal')

  assert.match(commands, /apiPost<AgentChangeProposal>[\s\S]*\{ idempotencyKey \}/)
  assert.match(commands, /comment\.id === expectedId && comment\.body === intent\.body/)
  assert.match(commands, /comments: \[\.\.\.\(candidate\.comments \?\? \[\]\), receipt\]\.sort/,
    'a delayed response appends only its receipt instead of replacing a newer verdict or thread')
  assert.match(commands, /apiGet<AgentChangeProposal\[]>\(paths\.agentProposals/)
  assert.match(facade, /const existing = heldComments\.get\(key\)[\s\S]*if \(existing\) return existing\.result/)
  assert.match(facade, /trim\(\)\.slice\(0, WORK_ITEM_COMMENT_MAX\)/)
  assert.match(facade, /intentId: crypto\.randomUUID\(\)/)
  assert.match(facade, /onAccountSwitch\([\s\S]*heldComments\.clear\(\)/)
  assert.match(runtime, /createAcknowledgedActionMutationController/)
  assert.match(runtime, /mintIdempotencyKey: \(intent\) => intent\.intentId/)

  const routeStart = routes.indexOf("r.post('/agents/:id/proposals/:pid/comments'")
  const routeEnd = routes.indexOf("r.post('/agents/:id/proposals/:pid/merge'", routeStart)
  assert.ok(routeStart >= 0 && routeEnd > routeStart)
  const route = routes.slice(routeStart, routeEnd)
  assert.match(route, /agentProposalCommentCreationId\(who\.tenant\.id, params\.id, params\.pid, idempotencyKey\)/)
  assert.match(route, /getAgentProposalCommentCreation\([\s\S]*if \(typeof represented === 'object'\) return sendJson/)
  assert.match(route, /commentOnAgentProposal\([\s\S]*\{ logicalId: logicalCommentId \}/)

  const storeStart = store.indexOf('  getAgentProposalCommentCreation(')
  const storeEnd = store.indexOf('  resolveAgentProposal(', storeStart)
  assert.ok(storeStart >= 0 && storeEnd > storeStart)
  const storeSlice = store.slice(storeStart, storeEnd)
  assert.match(storeSlice, /comment\.authorTenant !== tenantId \|\| comment\.body !== normalizedBody/)
  assert.match(storeSlice, /return commitMutationBatch\(\(\) => \{[\s\S]*comments\.push\(comment\)[\s\S]*notifyTenants\([\s\S]*emit\([\s\S]*persist\(\)/,
    'the receipt, other-party bell, signal, and persistence share one fail-closed commit')
  assert.match(notice, /kind="agent-proposal-comment-create"/)
  assert.match(shell, /<AgentProposalCommentCreationMutationNotice \/>/)
})
