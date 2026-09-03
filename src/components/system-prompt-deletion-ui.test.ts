import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

test('System Prompt removal is canonical, confirmed, revision-pinned, retained, and recoverable', () => {
  const view = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  const commands = stripComments(read(join(ROOT, 'src', 'api', 'commands.ts')))
  const facade = stripComments(read(join(ROOT, 'src', 'controller', 'systemPromptDeletionMutations.ts')))
  const runtime = stripComments(read(join(ROOT, 'src', 'controller', 'systemPromptDeletionMutationRuntime.ts')))
  const holds = stripComments(read(join(ROOT, 'src', 'controller', 'systemPromptMutationHolds.ts')))
  const definition = stripComments(read(join(ROOT, 'src', 'controller', 'systemPromptDefinitionMutations.ts')))
  const notice = stripComments(read(join(ROOT, 'src', 'components', 'SystemPromptDefinitionMutationNotice.tsx')))

  assert.doesNotMatch(view, /deleteSystemPrompt\(/,
    'no prompt surface can bypass acknowledgement-owned removal')
  assert.match(view, /function LibraryPromptCard[\s\S]*?<CardActions[\s\S]*?onEdit=\{onEdit\}[\s\S]*?function ToolsTab/)
  assert.doesNotMatch(
    view.match(/function LibraryPromptCard[\s\S]*?function ToolsTab/)?.[0] ?? '',
    /onDelete=/,
    'destruction lives on the canonical Prompt page, not a hover-only index icon',
  )
  assert.match(view, /<ConfirmDialog[\s\S]*title=\{`Remove \$\{prompt\.label\}\?`\}/)
  assert.match(view, /body=\{SYSTEM_PROMPT_DELETE_SCOPE\}/)
  assert.match(facade, /permanently removes the reusable prompt from your library/)
  assert.match(facade, /Agents using it block removal until you choose another prompt/)
  assert.match(facade, /copied instructions and previous conversations are not changed/)
  assert.match(view, /heldSystemPromptDeletions\(\)\.filter[\s\S]*!currentPrompts\.some/)
  assert.match(view, /<AtomicResourcePage aria-busy=\{deleting\}>/)
  assert.match(view, /enqueueSystemPromptDeletion\(prompt\)/)
  assert.match(view, /promptIdRef\.current === promptId/,
    'a late acknowledgement cannot navigate away from a newer destination')

  assert.match(commands, /apiDelete\([\s\S]*paths\.systemPrompt\(id\)[\s\S]*expectedRevision[\s\S]*idempotencyKey/)
  assert.match(commands, /acceptSystemPromptAbsence\(id\)/)
  assert.match(runtime, /createRevisionedDeletionMutationController<SystemPromptEntry>/)
  assert.match(runtime, /revision: \(prompt\) => prompt\.definitionRevision \?\? 0/)
  assert.match(runtime, /still uses this prompt[\s\S]*rebaseOnRetry: false/)
  assert.match(runtime, /status === 409[\s\S]*rebaseOnRetry: true/)
  assert.match(facade, /heldSnapshots\.set\(prompt\.id, prompt\)/)
  assert.match(holds, /'definition', 'deletion'/)
  assert.match(definition, /acquireSystemPromptMutation\('definition', promptId\)/)
  assert.match(notice, /kind="system-prompt-delete"/)
})

test('shared built-in prompts expose neither edit nor removal controls', () => {
  const view = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  assert.match(view, /prompt\.tenantId && \([\s\S]{0,350}<PageActionButton[\s\S]{0,250}Edit prompt/)
  assert.match(view, /actions=\{prompt\.tenantId \? \([\s\S]{0,250}label="Remove prompt"/)
})
