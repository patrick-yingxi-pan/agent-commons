/** ── What a rail child is, and where a facet lives (UI-19) ───────────────────
 *  Rail navigation is an inline disclosure tree (VSCode-explorer style): a
 *  section with children carries a chevron and expands IN PLACE — children
 *  indented, siblings staying put, no push, no back button.
 *
 *  A child is a PLACE (owner directive, 2026-07-24): a declared SURFACE (the
 *  Agents hub's Prompts / Commissions / …; the maintainer console's panels) or
 *  one INSTANCE of the section's own list (a project, an artifact, a saved
 *  context, a provider, a thread). What a child is NOT is a partition of that
 *  list — kind, state, ownership — which is a FILTER. The rail row and the main
 *  page mirror the same Filter & sort control over one live, per-account value;
 *  neither projection turns a filter option into a navigation child.
 *
 *  These lock that shape: the two registries stay disjoint and derived, every
 *  listed kind is addressable (a place has an address — the URL half is locked
 *  in url-routes.test.ts), the rail and the page compute their list with ONE
 *  function, and no section body grows a second facet control. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { ROOT, read, concatSource, stripComments } from '../../tests/helpers/source.ts'
import {
  COMMONS_LENSES,
  OWNER_PROFILE_DOOR,
  RAIL_INSTANCE_CAP,
  SECTION_CHILDREN,
  SECTION_INSTANCE_KEY,
  SECTION_SUBVIEWS,
} from './subviews.ts'
import { SECTION_FILTERS, ALL_FACET, clampSectionFilter } from './sectionFilter.ts'
import { AGENT_SUBVIEWS } from './agentStructure.ts'
// Every section id — from the pure nav module, since `lib/sections.tsx` carries
// the icons (a .tsx node --test can't load).
import { SECTION_LABELS } from './nav.ts'

test('the fixed-child registry owns shared order while URL subviews remain canonical', () => {
  // Agents and the maintainer console: children that are genuinely different
  // PAGES. The Commons' five lenses are the viewer's own standing collections — not a
  // slice of the feed's content, which is why they are places and `shares` /
  // `landings` is a filter.
  assert.deepEqual(Object.keys(SECTION_CHILDREN).sort(), ['admin', 'agents', 'commons'])
  assert.deepEqual(Object.keys(SECTION_SUBVIEWS).sort(), ['admin', 'agents', 'commons'])
  // `following` (S7) joins them as the fifth — and the only one keyed on WHO
  // ACTED rather than on the subject, which is what makes the feed social.
  assert.deepEqual(COMMONS_LENSES.map((s) => s.id), ['following', 'watched', 'liked', 'posted', 'viewed'])
  assert.equal(SECTION_CHILDREN.commons?.[0], OWNER_PROFILE_DOOR)
  assert.deepEqual(SECTION_CHILDREN.commons?.map((child) => [child.kind, child.id]), [
    ['owner-profile', 'profile'],
    ...COMMONS_LENSES.map((lens) => ['subview', lens.id]),
    ['subview', 'browse'],
  ])
  assert.deepEqual(SECTION_SUBVIEWS.commons.map((s) => s.id), [
    ...COMMONS_LENSES.map((s) => s.id),
    'browse',
  ], 'the directory is a real surface instead of a page-only list')
  assert.deepEqual(SECTION_SUBVIEWS.agents, AGENT_SUBVIEWS, 'Agents addresses derive from its nested structure')
  assert.deepEqual(SECTION_SUBVIEWS.admin.map((s) => s.id), ['orgs', 'credentials', 'audit', 'ops'])
  for (const children of Object.values(SECTION_CHILDREN)) {
    const ids = children.map((child) => child.id)
    assert.equal(new Set(ids).size, ids.length, 'child ids unique per section')
    for (const child of children) assert.ok(child.label.trim(), `${child.id} needs a label`)
    assert.ok(!ids.includes('all'), 'no "all" child — the section row is the all view')
  }
})

test('a section has ONE kind of list child: fixed children or instances, never both', () => {
  for (const id of Object.keys(SECTION_LABELS)) {
    assert.ok(
      !(SECTION_CHILDREN[id] && SECTION_INSTANCE_KEY[id]),
      `${id} declares fixed children AND instances — a tree row has one kind of list child`,
    )
  }
  // Scheduled is now an ordinary instance branch. Its richer routine filter is
  // still a single control on that row, shared live with the page.
  assert.equal(SECTION_SUBVIEWS.scheduled, undefined)
  assert.equal(SECTION_INSTANCE_KEY.scheduled, 'scheduleId')
  assert.equal(SECTION_FILTERS.scheduled, undefined)
  // Dispatch (a flat feed) and Customize (a settings stack) have neither.
  for (const id of ['dispatch', 'customize']) {
    assert.equal(SECTION_SUBVIEWS[id], undefined)
    assert.equal(SECTION_INSTANCE_KEY[id], undefined)
    assert.equal(SECTION_FILTERS[id], undefined)
  }
})

test('every section that LISTS rows can also order them — and vice versa', () => {
  // A capped list ("the top 8") is a lie unless the order is chosen, so a
  // section with instance children must carry a filter spec. The converse holds
  // too except for the Commons, whose feed has no per-row page to list.
  for (const id of Object.keys(SECTION_INSTANCE_KEY)) {
    assert.ok(
      SECTION_FILTERS[id] || id === 'scheduled',
      `${id} lists rows, so it needs one live Filter & sort control to order them`,
    )
  }
  for (const id of Object.keys(SECTION_FILTERS)) {
    assert.ok(
      SECTION_INSTANCE_KEY[id] || id === 'commons',
      `${id} has a facet but no list of its own — is its filter attached to anything?`,
    )
  }
  assert.ok(RAIL_INSTANCE_CAP >= 5 && RAIL_INSTANCE_CAP <= 20, 'the rail shows a useful head, not an inventory')
})

test('every facet spec is well-formed: an all option, unique ids, a real default sort', () => {
  for (const [id, spec] of Object.entries(SECTION_FILTERS)) {
    assert.ok(spec.facetLabel.trim() && spec.allLabel.trim(), `${id} names its facet dimension and its all option`)
    const ids = spec.facets.map((f) => f.id)
    assert.equal(new Set(ids).size, ids.length, `${id} facet ids unique`)
    assert.ok(!ids.includes(ALL_FACET), `${id} must not declare an "all" facet — ALL_FACET is the neutral value`)
    for (const f of spec.facets) assert.ok(f.label.trim(), `${id}/${f.id} needs a label`)
    assert.ok(spec.sorts.length > 0, `${id} offers at least one sort`)
    assert.ok(
      spec.sorts.some((s) => s.id === spec.defaultSort),
      `${id}'s default sort is one it actually offers`,
    )
  }
})

test('a stored choice this build no longer offers reads as neutral, never as an empty list', () => {
  // The clamp is at READ, never in storage (the rail's pane-height rule): a
  // retired facet id must not silently filter every row out of a list the user
  // then cannot explain.
  assert.deepEqual(clampSectionFilter('artifacts', { facet: 'gone', sortBy: 'alpha' }), { facet: ALL_FACET, sortBy: 'alpha' })
  assert.deepEqual(clampSectionFilter('artifacts', { facet: 'doc', sortBy: 'nonsense' }), { facet: 'doc', sortBy: 'recency' })
  // A section with no spec at all still answers (the rail asks before it knows).
  assert.equal(clampSectionFilter('dispatch', { facet: 'x', sortBy: 'y' }).facet, ALL_FACET)
})

test('the rail and the page compute a section’s list with the SAME function', () => {
  // The rail shows the head of the page's list. If the two derived it
  // separately, the eight names in the rail could be a different eight — which
  // is worse than showing none. Both directions are scanned: a funnel nobody
  // calls, and a caller that isn't both.
  const FUNNELS = {
    projects: 'listProjects',
    artifacts: 'listArtifacts',
    contexts: 'listContexts',
    models: 'listProviders',
    discussions: 'listDiscussions',
    scheduled: 'filterRoutines',
  }
  const rail = stripComments(
    read(join(ROOT, 'src', 'components', 'SectionTreeChildren.tsx')) +
      read(join(ROOT, 'src', 'components', 'Sidebar.tsx')),
  )
  const page = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  const lists = stripComments(
    read(join(ROOT, 'src', 'lib', 'sectionLists.ts')) +
      read(join(ROOT, 'src', 'lib', 'routineFilter.ts')),
  )
  for (const [section, fn] of Object.entries(FUNNELS)) {
    assert.ok(SECTION_INSTANCE_KEY[section], `${section} is an instance section`)
    assert.ok(lists.includes(`export function ${fn}(`), `${fn} is the shared list function`)
    assert.ok(rail.includes(`${fn}(`), `the rail's ${section} children go through ${fn}`)
    assert.ok(page.includes(`${fn}(`), `the ${section} page goes through ${fn}`)
  }
})

test('the instance tail row unfolds in place — never a jump to the section page', () => {
  // Owner directive (2026-07-31): "Show all — N more" under a section must
  // reveal the remaining rows inline, not navigate away. The rail is a
  // disclosure tree, so the tail is one more disclosure — and while unfolded it
  // reads "Show fewer", making the fold back the same control.
  const rail = stripComments(read(join(ROOT, 'src', 'components', 'SectionTreeChildren.tsx')))
  assert.match(rail, /const \[showAll, setShowAll\] = useState\(false\)/, 'the unfold is view state in the ONE InstanceRows funnel')
  assert.ok(rail.includes('aria-expanded={open}'), 'the tail row announces itself as a disclosure')
  assert.ok(rail.includes("'Show fewer'"), 'the unfolded tail offers the fold back')
  assert.ok(!rail.includes('onOpenSection'), 'no instance child treats the section page as its tail act')
})

test('a facet has one live value and no bespoke second filter grammar', () => {
  const components = concatSource('src/components') // comment-stripped
  assert.doesNotMatch(components, /_FILTER_TABS/, 'no per-section in-page filter option arrays')
  assert.doesNotMatch(components, /label="Show"/, 'no Contexts/Scheduled "Show" dropdown')
  assert.doesNotMatch(components, /label="Filter by"/, 'no Artifacts "Filter by" dropdown')
  // The Projects page's own "Sort by" dropdown was the last survivor of the
  // old arrangement — one list, two controls, in two different places.
  assert.doesNotMatch(components, /label="Sort by" value=/, 'no in-page sort dropdown')
  assert.doesNotMatch(components, /function Dropdown\(/, 'the generic in-page dropdown is gone with its last caller')
  // The section bodies read the STORED choice through the shared live hook —
  // never `loadSectionFilter` directly, which would give the page a private
  // copy that stops tracking the rail after the first change.
  const page = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  assert.ok(page.includes('useSectionFilter('), 'section bodies read the live value')
  assert.ok(!page.includes('loadSectionFilter('), 'and never a private snapshot of it')
  const menu = stripComments(read(join(ROOT, 'src', 'components', 'SectionFilterMenu.tsx')))
  assert.match(menu, /useSectionFilter\(section\)/, 'both projections subscribe through the same hook')
  assert.match(menu, /placement\?: 'rail' \| 'page'/, 'one rendered control adapts only its disclosure posture')
})

test('the rail is an inline disclosure tree, not a drill-in push', () => {
  const sidebar = read(join(ROOT, 'src', 'components', 'Sidebar.tsx'))
  assert.match(sidebar, /SECTION_CHILDREN/, 'the rail reads the complete fixed-child registry')
  assert.match(sidebar, /SECTION_INSTANCE_KEY/, 'and the instance registry')
  assert.match(sidebar, /function SectionTreeRow/, 'sections render as disclosure-tree rows')
  assert.match(sidebar, /toggleExpand/, 'nodes expand/collapse in place')
  assert.doesNotMatch(sidebar, /SectionSubmenu/, 'the drill-in sub-menu is gone')
  assert.doesNotMatch(sidebar, /ChevronLeft/, 'the "‹ Sections" back chip is gone — no push')
  // One predicate decides whether a row expands, so both kinds of child are
  // treated identically by every expand / fold-all / deep-link mechanism.
  assert.match(sidebar, /function hasChildren\(id: SectionId\)/)
  assert.match(sidebar, /!!SECTION_CHILDREN\[id\] \|\| !!SECTION_INSTANCE_KEY\[id\]/)
})

test('the rail shares one fold menu for the selected subtree and the complete panel', () => {
  const sidebar = read(join(ROOT, 'src', 'components', 'Sidebar.tsx'))
  assert.match(sidebar, /ariaLabel="Organize pane"/, 'focused acts share one labeled compact menu')
  assert.match(sidebar, /label: 'Fold all'/)
  assert.match(sidebar, /label: 'Unfold all'/)
  assert.doesNotMatch(sidebar, /ariaLabel="Rail view options"/, 'folding is not disguised as a second split button')
  assert.match(sidebar, /requestRailFold/, 'one handler drives both directions')
  assert.match(sidebar, /publishRailFold\(open, selectedRailEntry\.root\.key, selectedRailEntry\.path\)/, 'the selected entry and pane are the disclosure scope')
  assert.match(sidebar, /requestRailPanelFold/, 'the same menu has a complete-panel scope')
  assert.match(sidebar, /publishRailFold\(open, null, null\)/, 'null scope reaches every root in every rail pane')
  assert.match(sidebar, /label: 'Fold entire panel'/)
  assert.match(sidebar, /label: 'Unfold entire panel'/)
  const railSplit = read(join(ROOT, 'src', 'lib', 'railSplit.ts'))
  assert.match(railSplit, /nodeKey === signal\.targetKey/, 'path identity includes the selected subtree root')
  assert.match(railSplit, /signal\.targetKey === null/, 'the explicit forest scope includes every node')
  assert.match(sidebar, /setLayout\(`treeOpen\.\$\{id\}`, open\)/, 'whole-root posture persists through the shared preference funnel')
})

test('the rail is one canonical tree whose vertical split can root at any selected entry', () => {
  const sidebar = read(join(ROOT, 'src', 'components', 'Sidebar.tsx'))
  const railSplit = read(join(ROOT, 'src', 'components', 'RailSplit.tsx'))
  const railController = read(join(ROOT, 'src', 'controller', 'useRailSplit.ts'))
  // Two landmark-unique rail navs (WCAG): New session ("Create") and the Sections tree.
  assert.match(sidebar, /<nav aria-label="Create" className="mt-3 shrink-0 px-2">/)
  assert.match(sidebar, /aria-label="Sections"/, 'the one resource nav is labeled')
  assert.match(sidebar, /<RailSplit/)
  assert.match(sidebar, /visibleSections\.map\(\(id\) =>/, 'every projection derives from the same canonical tree')
  assert.match(sidebar, /data-rail-forest/, 'the complete forest is an explicit projection root')
  assert.match(sidebar, /data-rail-node-key=\{sectionNodeKey\}/, 'every top-level branch has stable identity')
  assert.match(sidebar, /data-rail-entry/, 'top-level resources can become a split anchor')
  assert.match(railSplit, /querySelectorAll<HTMLElement>\('\[data-rail-node-key\]'\)/)
  assert.match(railSplit, /data-rail-scroll-pane=\{path \|\| 'root'\}/, 'each view scrolls independently')
  assert.match(railSplit, /label=\{`Resize sidebar views \(\$\{path \|\| 'root'\}\)`\}/)
  assert.match(railController, /path: string; root: RailViewRoot/)
  assert.match(railController, /splitRailView\(tree, path, selection\.root, nextRailViewId\(\)\)/)
  assert.match(
    railController,
    /railCanClose: canCloseRailView\(railTree, focusedRailPane\)/,
    'the toolbar delegates closeability to the protected-forest model',
  )
  assert.match(railSplit, /ancestors\.unshift/, 'selection records its canonical ancestor path')
  assert.match(railSplit, /data-rail-root-hidden/, 'outside ancestors and siblings leave layout and accessibility')
  assert.match(railSplit, /data-rail-root-target/, 'the selected node is marked as the visible root')
  assert.doesNotMatch(sidebar, /PaneFoldHeader|railSectionsOpen|railRecentsOpen/)
  assert.match(sidebar, /id === 'sessions' \? \(\s*<SessionTreeChildren/)
  assert.doesNotMatch(sidebar, /data-rail-pane="scheduled"|railScheduledH|schedOpen/)
  assert.doesNotMatch(sidebar, /Lower pane|Close upper pane|Close lower pane|railSplitStart|railSplitH/)
  // The old duplicate-container accordion is gone.
  assert.doesNotMatch(sidebar, />Sections<|>Recents</)
})

test('the section body + controller route through the registry; a section lands on its default', () => {
  const sectionView = read(join(ROOT, 'src', 'components', 'SectionView.tsx'))
  assert.match(sectionView, /subview === null \?/, 'the Agents root is its complete overview, not one child disguised as the default')
  assert.match(sectionView, /AGENT_SECTIONS\.map/, 'the root projects every declared structural section')
  assert.match(sectionView, /subview \?\? 'accounts'/, 'the maintainer console does the same')
  // A bare-section door routes sub-view NULL into the focused pane (Phase 6).
  const controller = read(join(ROOT, 'src', 'controller', 'useSessionWorkspace.ts'))
  // The claim is the SUB-VIEW argument, not the arity: the door gained a third
  // `push` argument in 2026-08 (a bell's doors carry their origin, ADAPT-18),
  // and pinning the call's exact text failed on a change that left this rule
  // untouched. Match the argument this test is actually about.
  assert.match(
    controller,
    /routeSection\?\.\(s, sub \?\? null[,)]/,
    'opening a section lands on its default (null) sub-view',
  )
})
