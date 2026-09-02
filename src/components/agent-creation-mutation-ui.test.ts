import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

test('New Agent holds one exact creation intent until authoritative acknowledgement', () => {
  const view = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  const legacy = stripComments(read(join(ROOT, 'src', 'api', 'commands.ts')))
  const commands = stripComments(read(join(ROOT, 'src', 'api', 'agentCreationCommands.ts')))
  const controller = stripComments(read(join(ROOT, 'src', 'controller', 'agentCreationMutations.ts')))
  const runtime = stripComments(read(join(ROOT, 'src', 'controller', 'agentCreationMutationRuntime.ts')))
  const notice = stripComments(read(join(ROOT, 'src', 'components', 'AgentCreationMutationNotice.tsx')))
  const shell = stripComments(read(join(ROOT, 'src', 'components', 'ShellMutationNotices.tsx')))

  assert.doesNotMatch(legacy, /export async function createAgent/, 'legacy fire-and-invalidate creation is removed')
  assert.doesNotMatch(view, /createAgent\(/, 'the dialog cannot bypass acknowledged creation')
  assert.equal((view.match(/enqueueAgentCreation\(\{/g) ?? []).length, 1)
  assert.match(view, /tenantId: tenantId!/, 'the form binds its intent to the active account')
  assert.match(view, /busy=\{busy\}/, 'the exact submitted fields remain frozen while held')
  assert.match(view, /Your Agent details are still here/, 'Dismiss preserves the authored form')
  assert.match(controller, /intentId: crypto\.randomUUID\(\)/, 'one form submission owns one logical identity')
  assert.match(controller, /accountGeneration/, 'late acknowledgement is fenced by account scope')
  assert.match(commands, /agentCreationId\(intent\.tenantId, idempotencyKey\)/, 'reconciliation proves the exact tenant-scoped row')
  assert.match(commands, /apiPost<Agent>[\s\S]*idempotencyKey/, 'Retry retains the logical key')
  assert.match(commands, /mergeAgentConfiguration\(existing, agent\)/, 'a delayed create response cannot rewind newer Agent truth')
  assert.match(runtime, /mintIdempotencyKey: \(intent\) => intent\.intentId/, 'one key owns transport and durable row identity')
  assert.match(notice, /kind="agent-create"/, 'uncertainty has one shell-owned recovery surface')
  assert.match(shell, /<AgentCreationMutationNotice \/>/, 'Agent creation recovery is mounted exactly once in the shell')
})
