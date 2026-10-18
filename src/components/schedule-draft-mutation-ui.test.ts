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

test('routine Agent summaries and staged choices preserve missing identities through explicit repair', () => {
  const view = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  const summary = between(view, 'function ModelPanel(', 'function ScheduleModelPicker(')
  const picker = between(view, 'function ScheduleModelPicker(', 'function AutomationNotice(')
  for (const [name, subject] of [['summary', summary], ['picker', picker]] as const) {
    assert.match(subject, /routineAgentSelection\(/, `${name} uses the exact shared Agent resolution`)
    assert.doesNotMatch(subject, /agents\[0\]/, `${name} never borrows the first registry Agent`)
  }
  assert.match(summary, /data-routine-agent-state=\{agent \? 'available' : 'unavailable'\}/)
  assert.match(picker, /const selectedAgent = routineAgentSelection\(agents, agentId\)\.agent/)
  assert.match(picker, /if \(!selectedAgent \|\| busy\) return/,
    'a stale mounted selection cannot submit an unavailable identity')
  assert.match(picker, /!selectedAgent && <option value=\{agentId\} disabled>Unavailable Agent<\/option>/)
  assert.match(picker, /disabled=\{busy \|\| !selectedAgent\}/,
    'Apply requires the explicit selection to exist in the live registry')
})

test('every routine draft editor closes only after acknowledgement and survives explicit Dismiss', () => {
  const view = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  const page = stripComments(read(join(ROOT, 'src', 'components', 'ResourcePage.tsx')))
  const cadenceEditor = stripComments(read(join(ROOT, 'src', 'components', 'CadenceEditor.tsx')))
  const draftHook = stripComments(read(join(ROOT, 'src', 'controller', 'useScheduleDraftCommit.ts')))
  const detail = between(view, 'function ScheduledDetail(', 'function PromptCard(')
  const prompt = between(view, 'function PromptCard(', "type RailState = 'idle'")
  const workflow = between(view, 'function WorkflowCard(', 'function StepsEditor(')
  const steps = between(view, 'function StepsEditor(', 'function StepToolPicker(')
  const cadence = cadenceEditor.slice(cadenceEditor.indexOf('export function CadenceEditor('))
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

  assert.match(draftHook, /function useScheduleDraftCommit\([\s\S]*expectedRevision: number[\s\S]*update\(scheduleId, patch, expectedRevision\)[\s\S]*if \(outcome === 'applied'\)/,
    'all routine drafts settle through one acknowledgement-owned helper')
  assert.match(draftHook, /Your \$\{draftLabel\} draft was not saved/,
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
  assert.match(workflow, /task\.own === true && !editing/,
    'only the routine owner receives the workflow edit action')
  assert.match(workflow, /editing && task\.own === true \?/,
    'only the routine owner can render the workflow editor')
  assert.match(view, /function SchedulePanel[\s\S]*<FoldSection[\s\S]*title="Schedule"[\s\S]*heldOpen=\{busy\}[\s\S]*disabled=\{busy\}/,
    'the schedule uses one acknowledgement-owned busy state to hold the section and editor action')
  assert.match(prompt, /heldOpen=\{busy\}/, 'the instruction cannot fold away while its draft is uncertain')
  assert.match(delivery, /heldOpen=\{busy\}/, 'the delivery editor cannot fold away while its draft is uncertain')
  assert.match(model, /heldOpen=\{draftHeld\}/, 'the Agent and model picker cannot fold away while its draft is uncertain')
  assert.doesNotMatch(model, /onPick(?:Model|Effort|Provider)=\{[^}]*commit/,
    'Agent, provider, model, and effort choices are staged instead of emitting partial writes')
  assert.match(model, /await commit\(\s*\{[\s\S]*agentId[\s\S]*providerId[\s\S]*modelId[\s\S]*effort/,
    'one Apply acknowledges the complete unattended execution binding')
})
