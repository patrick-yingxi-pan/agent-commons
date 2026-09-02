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

test('every routine draft editor closes only after acknowledgement and survives explicit Dismiss', () => {
  const view = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  const page = stripComments(read(join(ROOT, 'src', 'components', 'ResourcePage.tsx')))
  const detail = between(view, 'function ScheduledDetail(', 'function PromptCard(')
  const prompt = between(view, 'function PromptCard(', "type RailState = 'idle'")
  const steps = between(view, 'function StepsEditor(', 'function StepToolPicker(')
  const cadence = between(view, 'function CadenceEditor(', 'function ModelPanel(')
  const delivery = between(view, 'function DeliveryPanel(', 'function ContextToolsPanel(')
  const model = between(view, 'function ModelPanel(', 'function DispatchView(')

  for (const [name, editor] of [
    ['name', detail],
    ['instruction', prompt],
    ['workflow', steps],
    ['cadence', cadence],
    ['delivery', delivery],
    ['Agent and model', model],
  ] as const) {
    assert.match(editor, /await commit\(/, `${name} holds its exact patch until resolution`)
    assert.match(editor, /(?:nameBaseRevision|baseRevision)\.current/,
      `${name} submits against the revision its draft was opened from`)
  }

  assert.match(view, /function useScheduleDraftCommit\([\s\S]*expectedRevision: number[\s\S]*updateSchedule\(scheduleId, patch, expectedRevision\)[\s\S]*if \(outcome === 'applied'\)/,
    'all routine drafts settle through one acknowledgement-owned helper')
  assert.match(view, /Your \$\{draftLabel\} draft was not saved/,
    'an explicit Dismiss preserves one visible non-success outcome for every draft')
  assert.match(detail, /aria-busy=\{nameBusy\}[\s\S]*<input[\s\S]*disabled=\{nameBusy\}/,
    'rename freezes its submitted input immediately')
  for (const [name, editor] of [
    ['instruction', prompt],
    ['workflow', steps],
    ['cadence', cadence],
    ['delivery', delivery],
    ['Agent and model', model],
  ] as const) {
    assert.match(editor, /<fieldset disabled=\{busy\}/, `${name} freezes its complete submitted form`)
  }
  assert.match(page, /const effectiveFolded = sectionPage \|\| heldOpen \? false : folded/,
    'a held child draft cannot be folded out of the tree')
  assert.match(view, /<FoldSection[\s\S]*title="Workflow"[\s\S]*heldOpen=\{draftHeld\}/,
    'the workflow section connects its draft hold to the shared fold primitive')
  assert.match(view, /<FoldSection[\s\S]*title="Schedule"[\s\S]*heldOpen=\{draftHeld\}/,
    'the schedule section connects its draft hold to the shared fold primitive')
  assert.match(prompt, /heldOpen=\{busy\}/, 'the instruction cannot fold away while its draft is uncertain')
  assert.match(delivery, /heldOpen=\{busy\}/, 'the delivery editor cannot fold away while its draft is uncertain')
  assert.match(model, /heldOpen=\{draftHeld\}/, 'the Agent and model picker cannot fold away while its draft is uncertain')
  assert.doesNotMatch(model, /onPick(?:Model|Effort|Provider)=\{[^}]*commit/,
    'Agent, provider, model, and effort choices are staged instead of emitting partial writes')
  assert.match(model, /await commit\(\s*\{[\s\S]*agentId[\s\S]*providerId[\s\S]*modelId[\s\S]*effort/,
    'one Apply acknowledges the complete unattended execution binding')
})
