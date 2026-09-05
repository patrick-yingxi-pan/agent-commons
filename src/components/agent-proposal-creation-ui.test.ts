import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

test('Agent proposal creation holds one exact authored form until durable server truth', () => {
  const view = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  const legacy = stripComments(read(join(ROOT, 'src', 'api', 'commands.ts')))
  const commands = stripComments(read(join(ROOT, 'src', 'api', 'agentProposalCreationCommands.ts')))
  const controller = stripComments(read(join(ROOT, 'src', 'controller', 'agentProposalCreationMutations.ts')))
  const runtime = stripComments(read(join(ROOT, 'src', 'controller', 'agentProposalCreationMutationRuntime.ts')))
  const notice = stripComments(read(join(ROOT, 'src', 'components', 'AgentProposalCreationMutationNotice.tsx')))
  const shell = stripComments(read(join(ROOT, 'src', 'components', 'ShellMutationNotices.tsx')))
  const routes = stripComments(read(join(ROOT, 'server', 'routes', 'index.ts')))
  const store = stripComments(read(join(ROOT, 'server', 'store', 'index.ts')))

  assert.doesNotMatch(legacy, /export async function proposeAgentChange/,
    'there is no best-effort proposal door for callers to bypass through')
  assert.doesNotMatch(view, /proposeAgentChange\(/)
  assert.match(view, /const heldProposalCreation = entry \? heldAgentProposalCreation\(entry\.id\) : undefined/)
  assert.match(view, /\(proposing \|\| proposalCreationHeld\) && !own && !builtIn/)
  assert.match(view, /heldRequest=\{heldProposalCreation\?\.request\}/,
    'returning to the Agent reconstructs the complete authored form')
  assert.match(view, /enqueueAgentProposalCreation\(\{[\s\S]*tenantId: me\.tenant\.id,[\s\S]*agentId: entry\.id,[\s\S]*request:/)
  assert.match(view, /if \(outcome === 'applied'\) onClose\(\)/,
    'only exact acknowledgement dismisses the form')
  assert.match(view, /kind="agent-proposal-creation"[\s\S]*busy=\{held \|\| busy\}/,
    'the portal-owned dialog itself carries held state rather than an empty wrapper')
  assert.match(view, /disabled=\{held \|\| busy\}/,
    'every value-bearing field freezes while acknowledgement is uncertain')
  assert.match(view, /onClose=\{\(\) => \{ if \(!held\) onClose\(\) \}\}/)

  assert.match(controller, /const heldIntents = new Map<string, AgentProposalCreationIntent>\(\)/,
    'the whole form intent, not just an id, survives navigation')
  assert.match(controller, /intentId: crypto\.randomUUID\(\)/)
  assert.match(controller, /accountGeneration/, 'late acknowledgement is fenced by account scope')
  assert.match(controller, /import\('\.\/agentProposalCreationMutationRuntime\.ts'\)/,
    'the low-frequency transport remains outside the critical bundle')
  assert.match(commands, /apiPost<AgentChangeProposal>[\s\S]*idempotencyKey/)
  assert.match(commands, /agentProposalCreationId\([\s\S]*intent\.tenantId,[\s\S]*intent\.agentId,[\s\S]*idempotencyKey/)
  assert.match(commands, /proposal\.id === expectedId/, 'reconciliation accepts only the derived durable proposal')
  assert.match(runtime, /createAcknowledgedActionMutationController/)
  assert.match(runtime, /mintIdempotencyKey: \(intent\) => intent\.intentId/)

  const routeStart = routes.indexOf("r.post('/agents/:id/proposals'")
  const routeEnd = routes.indexOf("r.get('/agents/:id/proposals'", routeStart)
  assert.ok(routeStart >= 0 && routeEnd > routeStart)
  const route = routes.slice(routeStart, routeEnd)
  assert.match(route, /idempotent\(async/)
  assert.match(route, /getAgentProposalCreation\([\s\S]*return sendJson\(res, represented\)[\s\S]*await body<ProposeAgentChangeRequest>/,
    'durable represented truth answers before changed Retry input is parsed')
  assert.match(store, /id: options\.logicalId \?\? `\$\{agentId\}-p\$\{list\.length \+ 1\}`/)
  assert.match(store, /return commitMutationBatch\(\(\) => \{[\s\S]*list\.push\(proposal\)[\s\S]*notifyTenants\([\s\S]*persist\(\)/,
    'proposal, owner bell, event, and persistence share one commit')
  assert.match(notice, /kind="agent-proposal-create"/)
  assert.match(shell, /<AgentProposalCreationMutationNotice \/>/)
})
