import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

function agentPage(): string {
  const view = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  const start = view.indexOf('function AgentPublicPage')
  const end = view.indexOf('function YourProposals', start)
  assert.ok(start >= 0 && end > start)
  return view.slice(start, end)
}

test('Fork agent is one held, recoverable, exact-identity copy action', () => {
  const page = agentPage()
  const commands = stripComments(read(join(ROOT, 'src', 'api', 'agentForkCommands.ts')))
  const legacyCommands = stripComments(read(join(ROOT, 'src', 'api', 'commands.ts')))
  const facade = stripComments(read(join(ROOT, 'src', 'controller', 'agentForkMutations.ts')))
  const runtime = stripComments(read(join(ROOT, 'src', 'controller', 'agentForkMutationRuntime.ts')))
  const store = stripComments(read(join(ROOT, 'server', 'store', 'index.ts')))
  const notice = stripComments(read(join(ROOT, 'src', 'components', 'AgentForkMutationNotice.tsx')))
  const shell = stripComments(read(join(ROOT, 'src', 'components', 'ShellMutationNotices.tsx')))

  assert.doesNotMatch(page, /\bforkAgent\(/,
    'the canonical page cannot bypass the acknowledgement-owned controller')
  assert.doesNotMatch(legacyCommands, /export async function forkAgent/,
    'there is no second best-effort transport door that future callers can bypass through')
  assert.match(page, /enqueueAgentFork\(\{[\s\S]*tenantId: me\.tenant\.id,[\s\S]*sourceAgentId: entry\.id/)
  assert.match(page, /disabled=\{forkHeld \|\| !me\}/)
  assert.match(page, /aria-busy=\{forkHeld \|\| undefined\}/)
  assert.match(page, /forkHeld \? 'Forking…' : 'Fork agent'/)
  assert.match(page, /result\.outcome === 'applied'[\s\S]*agentMountedRef\.current[\s\S]*agentLocationRef\.current === origin[\s\S]*onOpenAgent\(result\.agentId\)/,
    'only the still-owning source page follows acknowledged truth')
  assert.match(page, /The Agent wasn’t forked/,
    'Dismiss releases the source action with an inline explanation')

  assert.match(commands, /apiPost<Agent>\(paths\.agentFork\(intent\.sourceAgentId\), \{\}, \{ idempotencyKey \}\)/)
  assert.match(commands, /agentForkCreationId\(intent\.tenantId, idempotencyKey\)/)
  assert.match(commands, /agent\.id !== expectedId \|\| !hasFrozenLineage\(agent, intent\)/,
    'both acknowledgement and reconciliation require exact identity plus lineage')
  assert.match(commands, /agent\.forkedFrom\?\.agentId === intent\.sourceAgentId/)

  assert.match(facade, /intentId: crypto\.randomUUID\(\)/)
  assert.match(facade, /const existing = heldSources\.get\(input\.sourceAgentId\)[\s\S]*if \(existing\) return existing/,
    'repeat activation shares the held result instead of minting another fork')
  assert.match(facade, /accountGeneration/)
  assert.match(facade, /import\('\.\/agentForkMutationRuntime\.ts'\)/,
    'low-frequency transport stays behind the action runtime boundary')
  assert.match(runtime, /createAcknowledgedActionMutationController/)
  assert.match(store, /forkAgent\([\s\S]*return commitMutationBatch\(\(\) => \{[\s\S]*forkedFrom:[\s\S]*creditedSource[\s\S]*notifyTenants[\s\S]*persist\(\)/,
    'copy, source credit, owner bell, events, and persistence share one durable batch')
  assert.match(store, /if \(isAgentCreationId\(id\)\) retiredAgentCreationIds\.add\(id\)/,
    'deletion retires keyed direct and fork identities')
  assert.match(notice, /kind="agent-fork"/)
  assert.match(shell, /<AgentForkMutationNotice \/>/)
})
