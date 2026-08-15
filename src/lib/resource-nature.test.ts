import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { COMPOSITE_CHILD_KINDS, ACCOUNT_RESOURCE_NATURE, isCompositeResource } from './resourceNature.ts'
import { ROOT, read, stripComments, sectionViewComponent } from '../../tests/helpers/source.ts'

test('the account-resource ontology is total and only canonical children make a composite', () => {
  assert.deepEqual(
    Object.entries(ACCOUNT_RESOURCE_NATURE).filter(([, nature]) => nature === 'composite').map(([kind]) => kind).sort(),
    ['project', 'schedule'],
  )
  assert.equal(isCompositeResource('artifact'), false)
  assert.equal(isCompositeResource('work'), false)
  assert.equal(isCompositeResource('change'), false)
  assert.equal(isCompositeResource('agent'), false)
  assert.equal(isCompositeResource('session'), false, 'linked provenance does not make a session contain those resources')
  assert.equal(isCompositeResource('project'), true)
  assert.deepEqual(COMPOSITE_CHILD_KINDS.schedule, ['session', 'discussion'], 'a routine composes run sessions and its canonical discussion, not internal steps')
})

test('every composite projects its canonical children in the rail', () => {
  const tree = stripComments(read(join(ROOT, 'src', 'components', 'SectionTreeChildren.tsx')))
  const sidebar = stripComments(read(join(ROOT, 'src', 'components', 'Sidebar.tsx')))
  for (const kind of COMPOSITE_CHILD_KINDS.project) {
    assert.match(tree, new RegExp(`kind: '${kind}'`), `a project exposes its ${kind} children in the forest`)
  }
  assert.match(sidebar, /task\.runs\.map/, 'a routine exposes each run session beneath the routine')
  assert.match(sidebar, /onSelect\(runSessionId\(t\.id, runId\)\)/, 'a run child opens its canonical session')
  assert.match(sidebar, /onOpenSchedule\(t\.id\)/, 'the composite row opens the parent, never skips to its newest child')
})

test('composite main pages use the project reading-column form and enumerate the same child kinds', () => {
  const project = stripComments(sectionViewComponent('ProjectDetail'))
  const schedule = stripComments(sectionViewComponent('ScheduledDetail'))
  for (const body of [project, schedule]) {
    assert.match(body, /max-w-3xl/, 'the composite page uses the shared reading column')
    assert.match(body, /<SectionFoldControls/, 'the composite page offers the shared fold scope')
    assert.doesNotMatch(body, /<aside\b/, 'a composite never moves part of itself into a second page rail')
  }
  const projectChildren = {
    work: /<OpenWorkList\b/,
    agent: /<ContributorsPanel\b/,
    artifact: /title="Artifacts"/,
    context: /title="Context"/,
    schedule: /title="Routines"/,
    change: /<ChangesPanel\b/,
    session: /title="Recent sessions"/,
    discussion: /<DiscussionsPanel\b/,
  }
  for (const kind of COMPOSITE_CHILD_KINDS.project) {
    assert.match(project, projectChildren[kind], `the project page projects its ${kind} children`)
  }
  for (const [title, component] of [
    ['Instruction', 'PromptCard'],
    ['Workflow', 'WorkflowCard'],
    ['Recent runs', 'RunHistoryCard'],
  ] as const) {
    assert.match(schedule, new RegExp(`<${component}\\b`), `the routine page projects ${title}`)
  }
})
