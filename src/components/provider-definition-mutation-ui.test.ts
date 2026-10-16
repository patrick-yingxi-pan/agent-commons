import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

test('provider definitions use one sparse held-draft recovery path', () => {
  const section = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  const dialogs = stripComments(read(join(ROOT, 'src', 'components', 'ProviderDialogs.tsx')))
  const form = stripComments(read(join(ROOT, 'src', 'components', 'FormDialog.tsx')))
  const commands = stripComments(read(join(ROOT, 'src', 'api', 'commands.ts')))
  const controller = stripComments(read(join(ROOT, 'src', 'controller', 'providerDefinitionMutations.ts')))

  assert.match(dialogs, /import \{ updateProviderDefinition \} from '\.\.\/controller\/providerDefinitionMutations\.ts'/,
    'provider surfaces enter the acknowledgement queue, not the transport door')
  assert.doesNotMatch(section, /updateProvider,[\s\S]*from '\.\.\/api'/,
    'the component has no unconditional provider-definition command path')
  assert.doesNotMatch(dialogs, /updateProvider,[\s\S]*from '\.\.\/api'/,
    'the extracted forms cannot bypass acknowledgement either')
  assert.match(dialogs, /const original = useRef\(provider\)\.current/,
    'ambient refresh cannot reinterpret a remote provider field as local intent')
  assert.match(dialogs, /labelChanged[\s\S]*familyChanged[\s\S]*defaultChanged/,
    'every exposed edit field has explicit dirty semantics')
  assert.match(dialogs, /const outcome = await updateProviderDefinition\(provider\.id, \{/,
    'the exact sparse patch remains held through conflict recovery')
  assert.match(dialogs, /busy=\{busy\}/,
    'provider edits pass their held state to the shared form')
  assert.match(form, /fieldsDisabled = busy[\s\S]*<fieldset disabled=\{fieldsDisabled\}/,
    'a queued draft cannot change underneath its frozen retry payload')
  assert.match(dialogs, /import \{ FormDialog, FormField \} from '\.\/FormDialog\.tsx'/,
    'provider dialogs use the guarded shared form')
  assert.match(form, /const close = \(\) => \{\s*if \(!busy\) onClose\(\)/,
    'Escape, scrim, Close, and Cancel cannot discard a held draft while its mutation is unresolved')
  assert.match(controller, /createRevisionedMutationController<ModelProvider, ProviderDefinitionMutationPatch>/,
    'provider edits reuse the shared FIFO/reconcile/idempotency mechanism')
  assert.match(commands, /export async function patchProviderDefinition\([\s\S]*expectedRevision[\s\S]*idempotencyKey/,
    'the transport door requires ordering and logical replay identity')
  assert.match(commands, /if \(!rows \|\| index < 0\) return provider/,
    'a delayed acknowledgement cannot resurrect a provider removed by ambient sync')
})
