import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

test('Agent configuration has one recovery door and the editor replays only user-dirty fields', () => {
  const section = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  const commands = stripComments(read(join(ROOT, 'src', 'api', 'commands.ts')))
  const controller = stripComments(read(join(ROOT, 'src', 'controller', 'agentMutations.ts')))

  assert.match(section, /import \{[\s\S]{0,180}updateAgent,[\s\S]{0,180}\} from '\.\.\/controller\/agentMutations'/,
    'Agent surfaces enter the acknowledgement queue, not the transport door')
  assert.doesNotMatch(section, /updateAgent,[\s\S]*from '\.\.\/api'/,
    'the component cannot retain a second unconditional command path')
  assert.match(section, /const original = useRef\(agent\)\.current/,
    'ambient refresh cannot reinterpret remote fields as this form’s intent')
  assert.match(section, /providerChanged[\s\S]*promptChanged[\s\S]*toolsChanged/,
    'binding and grant fields have explicit dirty semantics')
  assert.match(section, /const outcome = await updateAgent\(agent\.id, fields\)/,
    'the exact sparse patch stays held through recovery')
  assert.match(section, /<fieldset disabled=\{busy\}/,
    'a queued draft cannot keep changing underneath its frozen retry payload')
  assert.match(section, /agent && !agent\.providerId[\s\S]*Choose a provider/,
    'an existing unbound Agent cannot display an unsaved default provider')
  assert.match(controller, /createRevisionedMutationController<Agent, AgentConfigurationPatch>/,
    'Agent edits reuse the proven FIFO/reconcile/idempotency mechanism')
  assert.match(commands, /export async function patchAgent\([\s\S]*expectedRevision[\s\S]*idempotencyKey/,
    'the transport door requires both ordering and logical replay identity')
  assert.match(commands, /if \(index < 0\) return current/,
    'a delayed PATCH acknowledgement cannot resurrect an Agent already removed by ambient sync')
})
