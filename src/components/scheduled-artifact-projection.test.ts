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

test('standing artifact format and name replace the base connector in every routine delivery projection', () => {
  const view = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  const controller = stripComments(read(join(ROOT, 'src', 'controller', 'useRelations.tsx')))
  const compact = between(view, 'function MiniPipeline(', 'function NewScheduleControl(')
  const detail = between(view, 'function ScheduledDetail(', 'function PromptCard(')
  const workflow = between(view, 'function WorkflowCard(', 'function StepsEditor(')
  const delivery = between(view, 'function DeliveryPanel(', 'function ContextToolsPanel(')

  assert.match(controller, /scheduleArtifactFor: \(schedId: string\) => ScheduledArtifactSpec \| undefined/)
  assert.match(controller, /scheduleArtifactFor: \(schedId\) => parseScheduledArtifactSpec\(graph\.scheduleArtifact\[schedId\]\)/)

  for (const [name, projection] of [
    ['compact pipeline', compact],
    ['routine header', detail],
    ['workflow', workflow],
    ['delivery', delivery],
  ] as const) {
    assert.match(projection, /const artifactDelivery = rel\.scheduleArtifactFor\(task\.id\)/,
      `${name} reads the same acknowledged structured standing output`)
    assert.match(projection, /artifactDelivery\?\.name/,
      `${name} displays the standing artifact name`)
    assert.match(projection, /KIND_LABEL\[artifactDelivery\.kind\]/,
      `${name} names Document, Sheet, or Slides instead of the base connector`)
    assert.match(projection, /KIND_ICON\[artifactDelivery\.kind\]/,
      `${name} draws the structured artifact icon instead of the base connector icon`)
  }

  assert.match(workflow, /rel\.scheduleSessionFor\(task\.id\)/,
    'workflow retains the standing session fallback')
  assert.match(delivery, /rel\.scheduleSessionFor\(task\.id\)/,
    'delivery panel retains the standing session fallback')
  assert.match(compact, /artifactDelivery && ArtifactDeliveryIcon \? \([\s\S]*KIND_LABEL\[artifactDelivery\.kind\][\s\S]*: \([\s\S]*<PipeNode tool=\{task\.delivery\.tool\} \/>/,
    'the routine list uses the base connector only when no structured standing output exists')
})
