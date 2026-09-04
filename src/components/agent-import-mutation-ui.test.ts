import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

function importForm(): string {
  const view = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  const start = view.indexOf('function ImportAgentCardForm')
  const end = view.indexOf('function PublishedAgentRow', start)
  assert.ok(start >= 0 && end > start)
  return view.slice(start, end)
}

test('Agent Card import is one held, recoverable, exact-origin creation action', () => {
  const form = importForm()
  const commands = stripComments(read(join(ROOT, 'src', 'api', 'agentImportCommands.ts')))
  const legacyCommands = stripComments(read(join(ROOT, 'src', 'api', 'commands.ts')))
  const facade = stripComments(read(join(ROOT, 'src', 'controller', 'agentImportMutations.ts')))
  const runtime = stripComments(read(join(ROOT, 'src', 'controller', 'agentImportMutationRuntime.ts')))
  const routes = stripComments(read(join(ROOT, 'server', 'routes', 'index.ts')))
  const store = stripComments(read(join(ROOT, 'server', 'store', 'index.ts')))
  const notice = stripComments(read(join(ROOT, 'src', 'components', 'AgentImportMutationNotice.tsx')))
  const shell = stripComments(read(join(ROOT, 'src', 'components', 'ShellMutationNotices.tsx')))

  assert.doesNotMatch(legacyCommands, /export async function importAgentCard/,
    'there is no second best-effort import door for future callers to bypass through')
  assert.match(form, /useAgentImportStatus\(\)/)
  assert.match(form, /const heldUrl = heldAgentImportUrl\(\)/)
  assert.match(form, /if \(heldUrl\) setUrl\(heldUrl\)/,
    'returning to Discover reconstructs the held URL instead of losing the form intent')
  assert.match(form, /enqueueAgentImport\(\{[\s\S]*tenantId: me\.tenant\.id,[\s\S]*request: \{ url: frozenUrl \}/)
  assert.match(form, /disabled=\{!!heldUrl\}/)
  assert.match(form, /heldUrl \? 'Importing…' : 'Import'/)
  assert.match(form, /result\.outcome === 'applied'[\s\S]*mountedRef\.current[\s\S]*onOpenAgent\(result\.agentId\)/,
    'only mounted initiating UI follows exact acknowledged truth')
  assert.match(form, /The Agent Card wasn’t imported/)

  assert.match(commands, /apiPost<Agent>\(paths\.agentImportCard, intent\.request, \{ idempotencyKey \}\)/)
  assert.match(commands, /agentImportCreationId\(intent\.tenantId, idempotencyKey\)/)
  assert.match(commands, /agent\.id !== expectedId \|\| !hasFrozenOrigin\(agent, intent\)/)
  assert.match(commands, /agent\.importedFrom\?\.url === intent\.request\.url/)

  assert.match(facade, /const frozenUrl = input\.request\.url\.trim\(\)/)
  assert.match(facade, /const existing = heldImports\.get\(frozenUrl\)[\s\S]*if \(existing\) return existing/,
    'repeated activation shares one logical import')
  assert.match(facade, /intentId: crypto\.randomUUID\(\)/)
  assert.match(facade, /import\('\.\/agentImportMutationRuntime\.ts'\)/)
  assert.match(runtime, /createAcknowledgedActionMutationController/)
  assert.match(runtime, /error\.code === 'upstream_unavailable'[\s\S]*retryable: true/)

  const routeStart = routes.indexOf("r.post('/agents/import-card'")
  const routeEnd = routes.indexOf("r.formPost('/projects/:id/effects'", routeStart)
  assert.ok(routeStart >= 0 && routeEnd > routeStart)
  const route = routes.slice(routeStart, routeEnd)
  assert.match(route, /getAgentCreation\([\s\S]*if \(typeof represented === 'object'\) return sendJson[\s\S]*await body<ImportAgentCardRequest>/,
    'represented truth and retirement are decided before body parsing or remote I/O')
  assert.match(route, /agentImportCreationId\(tenantId, idempotencyKey\)/)
  assert.match(store, /createAgent\([\s\S]*return commitMutationBatch\(\(\) => \{[\s\S]*WORKER_AGENTS\.set[\s\S]*emitAgentChanged[\s\S]*persist\(\)/,
    'Agent creation persists before its queued event publishes')
  assert.match(notice, /kind="agent-import"/)
  assert.match(shell, /<AgentImportMutationNotice \/>/)
})
