import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import {
  PROJECT_SECTIONS,
  SCHEDULE_SECTIONS,
  visibleCompositeSections,
} from './compositeSections.ts'
import { ROOT, read, resourcePageComponent, sectionViewComponent, stripComments } from '../../tests/helpers/source.ts'

test('the composite section registries name the complete ordered page skeleton', () => {
  assert.deepEqual(
    PROJECT_SECTIONS.map((section) => section.label),
    ['About', 'Attention', 'Contributors', 'Coordination', 'Open work', 'Artifacts', 'Instructions', 'Context', 'Sharing', 'Delegation', 'Routines', 'Changes', 'Recent sessions', 'Discussion'],
  )
  assert.deepEqual(
    SCHEDULE_SECTIONS.map((section) => section.label),
    ['Instruction', 'Workflow', 'Sharing', 'Schedule', 'Delivers to', 'Context & tools', 'Model', 'Recent runs', 'Improvements', 'Discussion'],
  )
  assert.ok(
    visibleCompositeSections(PROJECT_SECTIONS, false).every((section) => section.visibility === 'all'),
    'a visitor tree never advertises an owner-private section',
  )
  assert.deepEqual(visibleCompositeSections(PROJECT_SECTIONS, true), PROJECT_SECTIONS)
})

test('the rail projects composite → section → resource, never a flat descendant list', () => {
  const projects = stripComments(read(join(ROOT, 'src', 'components', 'SectionTreeChildren.tsx')))
  assert.match(projects, /visibleCompositeSections\(PROJECT_SECTIONS, project\.own !== false\)/)
  assert.match(projects, /sections\.map\(\(section\) => \(\s*<ProjectSectionBranch/)
  assert.match(projects, /onOpenDetail\('projects', \{ projectId, projectSectionId: section\.id \}\)/)
  assert.match(
    projects,
    /<RailTreeBranch data-project-section-resources=\{section\.id\}>/,
    'resource rows sit inside a guide one level below their section',
  )

  const routines = stripComments(read(join(ROOT, 'src', 'components', 'Sidebar.tsx')))
  assert.match(routines, /visibleCompositeSections\(SCHEDULE_SECTIONS, task\.own !== false\)/)
  assert.match(routines, /onOpenSection\(section\.id\)/, 'each routine section is a page door')
  assert.match(
    routines,
    /<RailTreeBranch data-routine-section-resources=\{section\.id\}>/,
    'run and discussion resources sit inside a guide below their section',
  )
})

test('a composite section destination renders only that section and forces its content open', () => {
  const project = stripComments(sectionViewComponent('ProjectDetail'))
  const routine = stripComments(sectionViewComponent('ScheduledDetail'))
  assert.match(project, /projectSection\(sectionId\)/)
  for (const section of PROJECT_SECTIONS) {
    assert.match(
      project,
      new RegExp(`showProjectSection\\('${section.id}'\\)`),
      `the Project overview and section router render ${section.label}`,
    )
  }
  assert.match(routine, /scheduleSection\(sectionId\)/)
  for (const section of SCHEDULE_SECTIONS) {
    assert.match(
      routine,
      new RegExp(`showScheduleSection\\('${section.id}'\\)`),
      `the routine overview and section router render ${section.label}`,
    )
  }
  for (const body of [project, routine]) {
    assert.match(body, /<CompositeResourcePage sectionPage=\{selectedSection !== undefined\}>/)
    assert.match(body, /!selectedSection && <CompositePageFoldControls/, 'the overview alone offers page-wide fold controls')
  }
  const composite = stripComments(resourcePageComponent('CompositeResourcePage'))
  assert.match(composite, /<CompositeSectionPageContext\.Provider value=\{sectionPage\}>/)
  const fold = stripComments(resourcePageComponent('ResourcePageSection'))
  assert.match(fold, /const effectiveFolded = sectionPage \? false : folded/)
})
