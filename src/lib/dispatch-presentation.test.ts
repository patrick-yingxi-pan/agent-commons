import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { dispatchPresentation, dispatchStatusLabel } from './dispatchPresentation.ts'
import type { DispatchRun } from '../../contract/index.ts'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

test('Dispatch capability presentation is independent of legacy simulation and fails closed', () => {
  const available = dispatchPresentation(true)
  assert.equal(available.available, true)
  assert.equal(available.state, 'available')
  assert.match(available.note, /chosen Agent and model/)
  assert.match(available.note, /private conversation/)
  assert.match(available.note, /review proposed actions, or continue the work/)
  assert.match(available.note, /External tool calls need your approval/)

  const unavailable = dispatchPresentation(false)
  assert.equal(unavailable.available, false)
  assert.equal(unavailable.state, 'unavailable')
  assert.match(unavailable.note, /Existing history is still readable/)

  const unknown = dispatchPresentation(undefined)
  assert.equal(unknown.available, false)
  assert.equal(unknown.state, 'unknown')
  assert.match(unknown.note, /No task can be started/)
})

test('Dispatch status labels distinguish legacy simulations from every real terminal state', () => {
  type DispatchState = NonNullable<DispatchRun['execution']>['state']
  const run = (state?: DispatchState) => ({
    id: 'd-test', title: 'Review', detail: '', status: 'failed', startedAt: 1,
    ...(state ? { execution: { agentId: 'a', providerId: 'p', modelId: 'm', kind: 'conversation', sessionId: 's', state } } : {}),
  }) as DispatchRun

  assert.equal(dispatchStatusLabel(run()), 'Simulation')
  assert.equal(dispatchStatusLabel({ ...run('running'), status: 'running' }), 'Running')
  assert.equal(dispatchStatusLabel({ ...run('replied'), status: 'done' }), 'Reply ready')
  assert.equal(dispatchStatusLabel(run('failed')), 'Failed')
  assert.equal(dispatchStatusLabel(run('interrupted')), 'Interrupted')
  assert.equal(dispatchStatusLabel(run('cancelled')), 'Stopped')
})

test('Dispatch UI and rail consume one presentation model without simulation gating', () => {
  const components = join(ROOT, 'src', 'components')
  const paths = (readdirSync(components, { recursive: true }) as string[])
    .filter((path) => path.endsWith('.tsx'))
    .map((path) => join(components, path))
  const sources = paths.map((path) => ({ path, source: stripComments(read(path)) }))
  const consumers = sources.filter(({ source }) =>
    /dispatchPresentation\(|dispatchAvailable\(|AUTOMATION_NOTICE_CLASS|function DispatchNotice\b/.test(source),
  )

  assert.deepEqual(
    consumers.map(({ path }) => relative(components, path)).sort(),
    ['CompositeRailControls.tsx', 'SectionView.tsx'],
    'main page and rail are the only Dispatch posture consumers',
  )

  const section = consumers.find(({ path }) => path.endsWith('/SectionView.tsx'))!.source
  const rail = consumers.find(({ path }) => path.endsWith('/CompositeRailControls.tsx'))!.source
  assert.match(rail, /dispatchAvailable\(capabilities\.status === 'error' \? undefined : capabilities\.data\?\.features\.dispatchExecution\)/)
  assert.match(rail, /section === 'dispatch' && !canDispatch/)
  assert.match(rail, /disabled: primaryUnavailable/)
  assert.match(rail, /if \(!primaryUnavailable\) onCommand\('primary-action'\)/)
  assert.doesNotMatch(rail, /automationPresentation|simulatedAutomation/)

  assert.match(section, /dispatchPresentation\(capabilities\.status === 'error' \? undefined : capabilities\.data\?\.features\.dispatchExecution\)/)
  assert.match(section, /onRailInvoke=\{dispatch\.available \? openDispatch : undefined\}/,
    'the rail mirror cannot bypass the real capability gate')
  assert.equal((section.match(/<DispatchNotice\s*\/>/g) ?? []).length, 2,
    'both the form and the feed disclose real Dispatch posture')
  assert.match(section, /function DispatchNotice\(\)/)
  assert.match(section, /data-dispatch-posture=\{posture\.state\}/)
  assert.match(section, /className=\{AUTOMATION_NOTICE_CLASS\}/)
  assert.match(section, /<AutomationNotice\s+kind="standing"\s*\/>/)
  assert.match(section, /<AutomationNotice\s+kind="work"\s*\/>/)

  const dialogStart = section.indexOf('function NewDispatchDialog(')
  const dialogEnd = section.indexOf('function ScheduledSection(', dialogStart)
  assert.ok(dialogStart >= 0 && dialogEnd > dialogStart, 'the source contains the complete Dispatch dialog')
  const dialog = section.slice(dialogStart, dialogEnd)
  assert.match(dialog, /const canCreate = dispatch\.available && Boolean\(bindingReady\) && title\.trim\(\)\.length > 0 && Boolean\(tenantId\)/)
  assert.match(dialog, /if \(!canCreate \|\| held \|\| !tenantId\) return/)
  assert.match(dialog, /canSubmit=\{canCreate && !held\}/)
})

test('Dispatch page preserves private continuation and distinguishes reply-ready from action completion', () => {
  const source = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  assert.match(source, /function DispatchView\(\{ onOpenSession \}: \{ onOpenSession: \(id: string\) => void \}\)/)
  assert.match(source, /onOpen=\{r\.execution \? \(\) => onOpenSession\(r\.execution!\.sessionId\) : undefined\}/,
    'only real runs open their private continuation conversation')
  assert.match(source, /Reply ready means a reply was saved, not that proposed actions were performed/)
  assert.match(source, /Interrupted runs are never restarted automatically/)
  assert.match(source, /selected Agent’s instructions and permitted workspace tools/)
  assert.doesNotMatch(source, /first turn uses only your instructions/,
    'no attached context does not remove normal Agent instructions or permitted workspace tools')
})
