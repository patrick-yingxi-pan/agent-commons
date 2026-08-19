/** Lock: filter state remains symmetric between a composite resource's two
 * projections, while bulk disclosure has one focus-aware shell home. */
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
import { COMPOSITE_FEATURES } from './compositeFeatures.ts'

const fn = (name: string) => stripComments(sectionViewComponent(name))
const templateFn = (name: string) => stripComments(resourcePageComponent(name))

test('the composite template keeps filters in-page and reports discovered fold work to shell chrome', () => {
  const controls = templateFn('CompositePageControls')
  assert.match(controls, /data-composite-page-controls/)
  assert.match(controls, /\{filter\}/, 'the filter occupies the same template toolbar')
  assert.match(controls, /useFocusedCompositeFold/, 'the focused page consumes that request')
  assert.match(controls, /usePublishFocusedCompositeFold/, 'the focused page reports truthful work to shell chrome')
  assert.doesNotMatch(controls, /<FoldPairButtons\b/, 'the page no longer redraws the shell fold menu')
  assert.doesNotMatch(controls, /Fold all sections/, 'the redundant page-top act stays absent')

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

  const sessions = fn('SessionsSection')
  assert.match(sessions, /<CompositePageControls[\s\S]{0,240}?<SessionFilterMenu\b/)
  assert.match(sessions, /useSessionFilter\(\)/, 'the page subscribes to the live Sessions filter')
  assert.match(sessions, /<SessionFilterMenu[^>]+placement="page"/, 'the Sessions page declares the visible page projection')

  const shared = stripComments(read(join(ROOT, 'src', 'components', 'SectionFilterMenu.tsx')))
  assert.match(shared, /useSectionFilter\(section\)/, 'both projections subscribe to one stored section choice')
  assert.match(shared, /<FilterMenu\b/, 'both projections share the same rendered menu primitive')

  const scheduled = stripComments(read(join(ROOT, 'src', 'components', 'ScheduledFilterMenu.tsx')))
  assert.match(scheduled, /placement = 'rail'/, 'the richer routine filter supports the same two placements')
  assert.match(scheduled, /<FilterMenu[\s\S]{0,180}?placement=\{placement\}/, 'routine controls delegate placement to the shared funnel')

  const sessionsMenu = stripComments(read(join(ROOT, 'src', 'components', 'SessionFilterMenu.tsx')))
  assert.match(sessionsMenu, /placement = 'rail'/, 'Sessions supports the same two explicit projections')
  assert.match(sessionsMenu, /active=\{isSessionFilterActive\(filter\)\}/, 'Sessions reports the same semantic filter state')

  const sessionStore = stripComments(read(join(ROOT, 'src', 'lib', 'useSessionFilter.ts')))
  assert.match(sessionStore, /useSyncExternalStore/, 'Sessions rail and page are two views of one external-store value')

  const sidebar = stripComments(read(join(ROOT, 'src', 'components', 'Sidebar.tsx')))
  const sectionView = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  assert.match(sidebar, /from '\.\/SectionFilterMenu'/, 'the rail consumes the shared control')
  assert.match(sectionView, /from '\.\/SectionFilterMenu'/, 'main pages consume the shared control')
})

test('only pages with filters or real sections mount composite controls', () => {
  for (const name of [
    'ProjectDetail',
    'ProjectsSection',
    'ArtifactsSection',
    'ContextsSection',
    'ModelsSection',
    'AgentCommonsSection',
    'ScheduledSection',
    'ScheduledDetail',
  ]) {
    assert.match(fn(name), /<CompositePageControls\b/, `${name} uses the composite toolbar`)
  }
  for (const name of ['NotificationsSection', 'MessagesSection', 'AdminSection', 'GenericSection']) {
    assert.doesNotMatch(fn(name), /<CompositePageControls\b/, `${name} has no empty toolbar for a flat list`)
  }
})

test('primary actions and local search are catalogued and projected from both surfaces', () => {
  const sectionView = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  const sidebar = stripComments(read(join(ROOT, 'src', 'components', 'Sidebar.tsx')))
  const rail = stripComments(read(join(ROOT, 'src', 'components', 'CompositeRailControls.tsx')))
  const action = stripComments(read(join(ROOT, 'src', 'components', 'PageActionButton.tsx')))

  assert.match(sidebar, /<CompositeRailControls\b/, 'every rail root projects the shared feature catalog')
  assert.match(rail, /COMPOSITE_FEATURES\[section\]/, 'the compact projection is driven by the one catalog')
  assert.doesNotMatch(rail, /requestCompositeFold|label: 'Fold all'/, 'resource overflow does not duplicate Organize pane')
  assert.match(action, /useCompositeCommand\(mirrorsRailFor, 'primary-action'/, 'page actions answer the rail command through one primitive')

  for (const [section, features] of Object.entries(COMPOSITE_FEATURES)) {
    if (features.primaryAction) {
      assert.match(
        sectionView,
        new RegExp(`mirrorsRailFor="${section}"`),
        `${section}'s main action registers the rail projection`,
      )
    }
    if (features.search) {
      assert.match(
        sectionView,
        new RegExp(`<SearchBox[^>]+mirrorsRailFor="${section}"`),
        `${section}'s local search answers the rail projection`,
      )
    }
  }
})

test('Organize pane targets the focused projection through one shared shell control', () => {
  const mainSplit = stripComments(read(join(ROOT, 'src', 'components', 'MainSplit.tsx')))
  const sectionPane = stripComments(read(join(ROOT, 'src', 'components', 'SectionPane.tsx')))
  const sectionView = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  const sidebar = stripComments(read(join(ROOT, 'src', 'components', 'Sidebar.tsx')))
  const app = stripComments(read(join(ROOT, 'src', 'App.tsx')))
  const controls = templateFn('CompositePageControls')

  assert.match(mainSplit, /focused=\{focused\}/, 'the split leaf reports which pane the rail controls')
  assert.match(sectionPane, /railProjectionActive=\{focused\}/, 'the section pane carries focus to the page')
  assert.match(sectionView, /<CompositeProjectionScope active=\{railProjectionActive\}>/)
  assert.match(controls, /usePublishFocusedCompositeFold/, 'main reports its live fold registry')
  assert.match(app, /useFocusedCompositeFoldAvailability\(\)/, 'shell consumes only the focused main report')
  assert.match(app, /requestCompositeFold\(focusedMainFold\.section, false\)/)
  assert.match(sidebar, /ariaLabel="Organize pane"/, 'rail and main share one labeled control')
  assert.match(sidebar, /selectedRailEntry\.root\.key/, 'rail focus scopes the request to its selected subtree')
  assert.match(sidebar, /railFoldSignal\.panePath === null \|\| railFoldSignal\.panePath === path/, 'a request reaches its selected pane or the whole panel')
  assert.match(sidebar, /const railOwnsOrganize = paneActionTarget === 'rail'/, 'rail focus owns the shared command pair')
  assert.match(sidebar, /railTargetsEntry/, 'a selected entry narrows rail focus to its subtree')
  assert.match(sidebar, /requestRailPanelFold/, 'rail focus without an entry uses the complete-panel scope')
  assert.match(sidebar, /onPointerDownCapture/, 'empty rail header chrome can focus that complete-panel scope')
  assert.doesNotMatch(sidebar, /Fold entire panel|Unfold entire panel|onFoldPanel/, 'scope never creates extra menu items')
  assert.doesNotMatch(sidebar, /useCompositeFoldSignal|branchFoldSignals/, 'main fold requests no longer leak into the rail')
})
