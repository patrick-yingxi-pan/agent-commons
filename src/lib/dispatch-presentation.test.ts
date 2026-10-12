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

test('Project work run metadata keeps a wrapping basis before its action controls', () => {
  const presentation = stripComments(read(join(ROOT, 'src', 'lib', 'dispatchPresentation.ts')))
  const panel = stripComments(read(join(ROOT, 'src', 'components', 'ProjectWorkDraftPanel.tsx')))
  assert.match(presentation, /export const DISPATCH_RUN_META_CLASS = 'min-w-0 grow basis-64 text-\[12px\] text-ink-soft'/,
    'the shared run metadata layout has a readable minimum basis and may yield before actions')
  assert.match(panel, /data-dispatch-run-meta[^\n]*className=\{DISPATCH_RUN_META_CLASS\}/,
    'the private-draft row exposes its exact shared metadata funnel to responsive geometry checks')
  assert.doesNotMatch(panel, /data-dispatch-run-meta[^\n]*flex-1/,
    'an equal-share flex item cannot starve its status text beside actions')
  assert.match(panel, /<button type="button" data-project-work-share[\s\S]*className=\{`\$\{SOFT_BUTTON_CLASS\} inline-flex items-center justify-center gap-1\.5/,
    'the comment action keeps its send icon and label on one centered line')
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
    ['CompositeRailControls.tsx', 'ContributionMcpDraftHelper.tsx', 'NewDispatchDialog.tsx', 'ProjectWorkDraftPanel.tsx', 'SectionView.tsx'],
    'the rail, ordinary form, Project work drafts, and feed consume Dispatch posture',
  )

  const section = consumers.find(({ path }) => path.endsWith('/SectionView.tsx'))!.source
  const rail = consumers.find(({ path }) => path.endsWith('/CompositeRailControls.tsx'))!.source
  const dialog = consumers.find(({ path }) => path.endsWith('/NewDispatchDialog.tsx'))!.source
  const projectDraft = consumers.find(({ path }) => path.endsWith('/ProjectWorkDraftPanel.tsx'))!.source
  const mcpDraft = consumers.find(({ path }) => path.endsWith('/ContributionMcpDraftHelper.tsx'))!.source
  assert.match(rail, /dispatchAvailable\(capabilities\.status === 'error' \? undefined : capabilities\.data\?\.features\.dispatchExecution\)/)
  assert.match(rail, /section === 'dispatch' && !canDispatch/)
  assert.match(rail, /disabled: primaryUnavailable/)
  assert.match(rail, /if \(!primaryUnavailable\) onCommand\('primary-action'\)/)
  assert.doesNotMatch(rail, /automationPresentation|simulatedAutomation/)

  assert.match(section, /dispatchPresentation\(capabilities\.status === 'error' \? undefined : capabilities\.data\?\.features\.dispatchExecution\)/)
  assert.match(section, /onRailInvoke=\{dispatch\.available \? openDispatch : undefined\}/,
    'the rail mirror cannot bypass the real capability gate')
  assert.equal((section.match(/<DispatchNotice\s*\/>/g) ?? []).length, 1,
    'the feed discloses Dispatch posture; its deferred form owns its separate disclosure')
  assert.match(section, /function DispatchNotice\(\)/)
  assert.match(section, /data-dispatch-posture=\{posture\.state\}/)
  assert.match(section, /className=\{AUTOMATION_NOTICE_CLASS\}/)
  assert.match(section, /<AutomationNotice\s+kind="standing"\s*\/>/)
  assert.match(section, /<AutomationNotice\s+kind="work"\s*\/>/)

  assert.match(dialog, /const canCreate = dispatch\.available && Boolean\(bindingReady\) && title\.trim\(\)\.length > 0 && Boolean\(tenantId\)/)
  assert.match(dialog, /if \(!canCreate \|\| held \|\| !tenantId\) return/)
  assert.match(dialog, /canSubmit=\{canCreate && !held\}/)
  assert.match(dialog, /data-dispatch-posture=\{dispatch\.state\}[\s\S]*className=\{AUTOMATION_NOTICE_CLASS\}[\s\S]*\{dispatch\.note\}/,
    'the deferred ordinary form presents the same capability-backed posture')
  for (const source of [projectDraft, mcpDraft]) {
    assert.match(source, /const dispatch = dispatchPresentation\(capabilities\.status === 'error' \? undefined : capabilities\.data\?\.features\.dispatchExecution\)/)
    assert.match(source, /!dispatch\.available && <InlineOperationStatus tone="status" message=\{dispatch\.note\} \/>/,
      'Project work drafting fails closed and displays the same Dispatch posture')
  }
  const assertMcpGate = (source: string) => assert.match(source, /const canStart = readsReady && dispatch\.available &&/,
    'MCP argument drafting requires affirmative Dispatch capability')
  assertMcpGate(mcpDraft)
  const ungated = mcpDraft.replace('readsReady && dispatch.available &&', 'readsReady &&')
  assert.notEqual(ungated, mcpDraft)
  assert.throws(() => assertMcpGate(ungated), /affirmative Dispatch capability/)
})

test('Dispatch page preserves private continuation and distinguishes reply-ready from action completion', () => {
  const source = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  const dialog = stripComments(read(join(ROOT, 'src', 'components', 'NewDispatchDialog.tsx')))
  assert.match(source, /function DispatchView\(\{ onOpenSession \}: \{ onOpenSession: \(id: string\) => void \}\)/)
  assert.match(source, /onOpen=\{r\.execution \? \(\) => onOpenSession\(r\.execution!\.sessionId\) : undefined\}/,
    'only real runs open their private continuation conversation')
  assert.match(source, /Reply ready means a reply was saved, not that proposed actions were performed/)
  assert.match(source, /Interrupted runs are never restarted automatically/)
  assert.match(dialog, /selected Agent’s instructions and permitted workspace tools/)
  assert.doesNotMatch(source, /first turn uses only your instructions/,
    'no attached context does not remove normal Agent instructions or permitted workspace tools')
})
