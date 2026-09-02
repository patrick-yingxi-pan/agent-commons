import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

function between(source: string, start: string, end: string): string {
  const from = source.indexOf(start)
  const to = source.indexOf(end, from)
  assert.notEqual(from, -1, `missing ${start}`)
  assert.notEqual(to, -1, `missing ${end}`)
  return source.slice(from, to)
}

test('routine draft editors close only after acknowledgement and survive explicit Dismiss', () => {
  const view = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  const page = stripComments(read(join(ROOT, 'src', 'components', 'ResourcePage.tsx')))
  const steps = between(view, 'function StepsEditor(', 'function StepToolPicker(')
  const cadence = between(view, 'function CadenceEditor(', 'function ModelPanel(')

  for (const [name, editor] of [['workflow', steps], ['cadence', cadence]] as const) {
    assert.match(editor, /const outcome = await updateSchedule\(/, `${name} holds its exact patch until resolution`)
    assert.match(editor, /if \(outcome === 'applied'\) \{[\s\S]*onClose\(\)/, `${name} closes only on acknowledgement`)
    assert.match(editor, /draft was not saved/, `${name} preserves a visible non-success outcome`)
    assert.match(editor, /<fieldset disabled=\{busy\}/, `${name} freezes its submitted fields`)
    assert.match(editor, /onHeldChange\(true\)/, `${name} holds its containing surface open while uncertain`)
  }

  assert.match(page, /const effectiveFolded = sectionPage \|\| heldOpen \? false : folded/,
    'a held child draft cannot be folded out of the tree')
  assert.match(view, /<FoldSection[\s\S]*title="Workflow"[\s\S]*heldOpen=\{draftHeld\}/,
    'the workflow section connects its draft hold to the shared fold primitive')
  assert.match(view, /<FoldSection[\s\S]*title="Schedule"[\s\S]*heldOpen=\{draftHeld\}/,
    'the schedule section connects its draft hold to the shared fold primitive')
})
