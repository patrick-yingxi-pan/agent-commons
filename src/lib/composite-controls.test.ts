/** Lock: a composite resource exposes the same view controls in both of its
 * projections. The rail and main page render two controls over one live filter
 * value; they do not mint two filter states. Fold all / Unfold all likewise
 * uses the one shared pair, while each projection folds its own rendered tree.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import {
  ROOT,
  read,
  resourcePageComponent,
  sectionViewComponent,
  stripComments,
} from '../../tests/helpers/source.ts'

const fn = (name: string) => stripComments(sectionViewComponent(name))
const templateFn = (name: string) => stripComments(resourcePageComponent(name))

test('the composite template owns one toolbar for filters and discovered fold work', () => {
  const controls = templateFn('CompositePageControls')
  assert.match(controls, /data-composite-page-controls/)
  assert.match(controls, /<FoldPairButtons\b/, 'page and rail share the exact fold pair')
  assert.match(controls, /\{filter\}/, 'the filter occupies the same template toolbar')

  const section = templateFn('ResourcePageSection')
  assert.match(section, /register\?\.register/, 'every rendered structural section joins the page fold scope')
  assert.match(section, /register\?\.update/, 'local and persisted section posture both stay live in the toolbar')
  assert.doesNotMatch(section, /persist \? register/, 'dynamic bands fold in bulk without growing stored preferences')
})

test('every filtered composite page mirrors the rail control over the same live state', () => {
  const filteredPages = {
    ProjectsSection: 'projects',
    CommonsSection: 'commons',
    DiscussionsSection: 'discussions',
    ArtifactsSection: 'artifacts',
    ContextsSection: 'contexts',
    ModelsSection: 'models',
  } as const
  for (const [component, section] of Object.entries(filteredPages)) {
    const page = fn(component)
    assert.match(
      page,
      new RegExp(`<CompositePageControls[\\s\\S]{0,180}?<SectionFilterMenu section="${section}"`),
      `${component} mirrors ${section}'s rail filter in the main-page toolbar`,
    )
  }

  const routines = fn('ScheduledSection')
  assert.match(routines, /<CompositePageControls[\s\S]{0,220}?<ScheduledFilterMenu\b/)
  assert.match(routines, /onChange=\{updateRoutineFilter\}/, 'the page writes the same live routine filter as the rail')

  const shared = stripComments(read(join(ROOT, 'src', 'components', 'SectionFilterMenu.tsx')))
  assert.match(shared, /useSectionFilter\(section\)/, 'both projections subscribe to one stored section choice')
  assert.match(shared, /<FilterMenu\b/, 'both projections share the same rendered menu primitive')

  const scheduled = stripComments(read(join(ROOT, 'src', 'components', 'ScheduledFilterMenu.tsx')))
  assert.match(scheduled, /placement = 'rail'/, 'the richer routine filter supports the same two placements')
  assert.match(scheduled, /data-filter-projection=\{placement\}/, 'routine controls identify their projection too')

  const sidebar = stripComments(read(join(ROOT, 'src', 'components', 'Sidebar.tsx')))
  const sectionView = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  assert.match(sidebar, /from '\.\/SectionFilterMenu'/, 'the rail consumes the shared control')
  assert.match(sectionView, /from '\.\/SectionFilterMenu'/, 'main pages consume the shared control')
})

test('composite pages without facets still expose discovered fold controls', () => {
  for (const name of [
    'ProjectDetail',
    'AgentCommonsSection',
    'NotificationsSection',
    'MessagesSection',
    'AdminSection',
    'GenericSection',
    'ScheduledDetail',
  ]) {
    assert.match(fn(name), /<CompositePageControls\b/, `${name} uses the composite toolbar`)
  }
})
