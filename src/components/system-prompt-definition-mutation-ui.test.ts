import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

test('system-prompt definitions use one bounded sparse held-draft recovery path', () => {
  const section = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  const form = stripComments(read(join(ROOT, 'src', 'components', 'FormDialog.tsx')))
  const commands = stripComments(read(join(ROOT, 'src', 'api', 'commands.ts')))
  const controller = stripComments(read(join(ROOT, 'src', 'controller', 'systemPromptDefinitionMutations.ts')))

  assert.match(section, /import \{[\s\S]*?updateSystemPromptDefinition[\s\S]*?\} from '\.\.\/controller\/systemPromptDefinitionMutations'/,
    'prompt surfaces enter the acknowledgement queue, not the transport door')
  assert.doesNotMatch(section, /updateSystemPrompt,[\s\S]*from '\.\.\/api'/,
    'the component has no unconditional prompt-definition command path')
  assert.match(section, /const original = useRef\(prompt\)\.current/,
    'ambient refresh cannot reinterpret a remote prompt field as local intent')
  assert.match(section, /labelChanged[\s\S]*familyChanged[\s\S]*bodyChanged[\s\S]*defaultChanged/,
    'every exposed edit field has explicit dirty semantics')
  assert.match(section, /const outcome = await updateSystemPromptDefinition\(prompt\.id, \{/,
    'the exact sparse patch remains held through conflict recovery')
  assert.match(section, /maxLength=\{MAX_SYSTEM_PROMPT_BODY_CHARS\}/,
    'the editor shares the server prompt-body ceiling')
  assert.match(section, /<fieldset disabled=\{busy\}/,
    'a queued draft cannot change underneath its frozen retry payload')
  assert.match(section, /import \{ FormDialog, FormField \} from '\.\/FormDialog\.tsx'/,
    'system-prompt dialogs use the guarded shared form')
  assert.match(form, /const close = \(\) => \{\s*if \(!busy\) onClose\(\)/,
    'Escape, scrim, Close, and Cancel cannot discard a held draft while unresolved')
  assert.match(controller, /createRevisionedMutationController<SystemPromptEntry, SystemPromptDefinitionMutationPatch>/,
    'prompt edits reuse the shared FIFO/reconcile/idempotency mechanism')
  assert.match(commands, /export async function patchSystemPromptDefinition\([\s\S]*expectedRevision[\s\S]*idempotencyKey/,
    'the transport door requires ordering and logical replay identity')
  assert.match(commands, /filter\(\(candidate\) => candidate\.id !== id\)/,
    'reconciliation removes a deleted prompt instead of resurrecting it')
})
