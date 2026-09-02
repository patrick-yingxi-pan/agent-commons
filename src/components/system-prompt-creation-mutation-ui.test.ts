import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

test('New Prompt holds one exact creation intent until authoritative acknowledgement', () => {
  const view = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  const legacy = stripComments(read(join(ROOT, 'src', 'api', 'commands.ts')))
  const commands = stripComments(read(join(ROOT, 'src', 'api', 'systemPromptCreationCommands.ts')))
  const store = stripComments(read(join(ROOT, 'server', 'store', 'index.ts')))
  const controller = stripComments(read(join(ROOT, 'src', 'controller', 'systemPromptCreationMutations.ts')))
  const runtime = stripComments(read(join(ROOT, 'src', 'controller', 'systemPromptCreationMutationRuntime.ts')))
  const notice = stripComments(read(join(ROOT, 'src', 'components', 'SystemPromptCreationMutationNotice.tsx')))
  const shell = stripComments(read(join(ROOT, 'src', 'components', 'ShellMutationNotices.tsx')))

  assert.doesNotMatch(legacy, /export async function createSystemPrompt/, 'legacy fire-and-invalidate creation is removed')
  assert.doesNotMatch(view, /createSystemPrompt\(/, 'the dialog cannot bypass acknowledged creation')
  assert.equal((view.match(/enqueueSystemPromptCreation\(\{/g) ?? []).length, 1)
  assert.match(view, /tenantId: tenantId!/, 'the form binds its intent to the active account')
  assert.match(view, /busy=\{busy\}/, 'the exact submitted fields remain frozen while held')
  assert.match(view, /Your prompt details are still here/, 'Dismiss preserves the authored form')
  assert.match(controller, /intentId: crypto\.randomUUID\(\)/, 'one form submission owns one logical identity')
  assert.match(controller, /accountGeneration/, 'late acknowledgement is fenced by account scope')
  assert.match(commands, /systemPromptCreationId\(intent\.tenantId, idempotencyKey\)/, 'reconciliation proves the exact tenant-scoped row')
  assert.match(commands, /mergeSystemPromptDefinition\(existing, entry\)/, 'a delayed create acknowledgement cannot rewind definition or default truth')
  assert.match(
    store,
    /createSystemPrompt\([\s\S]*?return commitMutationBatch\(\(\) => \{[\s\S]*?options\.isDefault === true[\s\S]*?setDefaultSystemPrompt/,
    'the row and optional initial default are one store transaction',
  )
  assert.match(runtime, /mintIdempotencyKey: \(intent\) => intent\.intentId/, 'one key owns transport and durable row identity')
  assert.match(notice, /kind="system-prompt-create"/, 'uncertainty has one shell-owned recovery surface')
  assert.match(shell, /<SystemPromptCreationMutationNotice \/>/, 'prompt creation recovery is mounted exactly once in the shell')
})
