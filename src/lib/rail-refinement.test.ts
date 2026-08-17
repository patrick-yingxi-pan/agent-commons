/** UI-32 — the left panel is one legible resource forest, not an inventory
 * plus duplicated utility panes. These source locks enumerate the funnels that
 * make depth, location, leaf density, and toolbar roles consistent. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { ROOT, read, stripComments } from '../../tests/helpers/source.ts'
import { SECTION_INSTANCE_KEY } from './subviews.ts'
import {
  SIDEBAR_ACTIVE,
  SIDEBAR_BRANCH,
  SIDEBAR_ENTRY_LEAD,
  SIDEBAR_FOCUS_WITHIN,
  sidebarEntryClass,
  type SidebarEntryKind,
} from './sidebar.ts'

const sidebar = stripComments(read(join(ROOT, 'src', 'components', 'Sidebar.tsx')))
const children = stripComments(read(join(ROOT, 'src', 'components', 'SectionTreeChildren.tsx')))
const sectionView = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))

test('Routines is one instance branch in Sections, never a duplicate pane', () => {
  assert.equal(SECTION_INSTANCE_KEY.scheduled, 'scheduleId')
  assert.match(sidebar, /id === 'scheduled' \? \(\s*<ScheduledTreeChildren/)
  assert.match(sidebar, /<ScheduledFilterMenu/)
  assert.doesNotMatch(sidebar, /data-rail-pane="scheduled"|Resize Scheduled pane|railScheduledH|schedOpen/)
  assert.match(sidebar, /id === 'sessions' \? \(\s*<SessionTreeChildren/, 'Sessions is a peer resource branch')
  assert.doesNotMatch(sidebar, /PaneFoldHeader|Expand Recents|Collapse Recents/)
})

test('the resizable rail has one visible seam, owned by its resize handle', () => {
  assert.match(sidebar, /resizable \? '' : 'border-r border-line'/, 'a fixed-width drawer keeps its own edge')
  assert.doesNotMatch(
    sidebar,
    /<aside className="[^"]*border-r border-line/,
    'the resizable desktop rail does not stack a border behind its handle',
  )
  assert.match(sidebar, /label="Resize sidebar"\s+ownsEdge/, 'the rail assigns its one edge to the handle')
  const resizeHandle = stripComments(read(join(ROOT, 'src', 'components', 'ResizeHandle.tsx')))
  assert.match(
    resizeHandle,
    /side === 'left' \? 'left-0' : 'right-0'/,
    'an edge-owning handle aligns its hairline with the actual panel boundary',
  )
  assert.match(resizeHandle, /w-px bg-line group-hover:/, 'the owned edge remains one persistent hairline')
})

test('every disclosed level composes the same visible branch guide', () => {
  assert.match(SIDEBAR_BRANCH, /border-l/)
  assert.match(children, /export function RailTreeBranch/)
  assert.match(sidebar, /<RailTreeBranch data-section-tree=\{id\}>/, 'section → instance uses the guide')
  assert.match(children, /<RailTreeBranch data-project-tree=\{project\.id\}>/, 'project → section uses it')
  assert.match(children, /data-project-section-resources=\{section\.id\}/, 'section → resource uses it')
  assert.match(sidebar, /<RailTreeBranch data-routine-tree=\{task\.id\}>/, 'routine → section uses it')
})

test('resource leaves spend width on identity, not a repeated kind label', () => {
  const start = children.indexOf('export function SubNavRow')
  const end = children.indexOf('export function OwnerProfileChild')
  assert.ok(start >= 0 && end > start, 'SubNavRow has an enumerable source body')
  const row = children.slice(start, end)
  assert.doesNotMatch(row, />\s*\{kind\}\s*</, 'the semantic style role is never printed as a redundant label')
  assert.match(row, /min-w-0 flex-1 truncate text-left/, 'the resource name owns remaining width')
  assert.match(row, /<RailEntryLead\s*\/>/, 'an atomic leaf keeps the shared lead column')
})

test('every leaf-like rail row keeps the lead column and partitions remain nested lists', () => {
  assert.match(SIDEBAR_ENTRY_LEAD, /\bw-5\b/, 'one fixed lead width owns horizontal alignment')
  for (const name of ['ShowAllRow', 'NoRowsRow'] as const) {
    const start = children.indexOf(`export function ${name}`)
    const end = children.indexOf('\nexport ', start + 1)
    assert.ok(start >= 0 && end > start, `${name} has an enumerable source body`)
    assert.match(children.slice(start, end), /<RailEntryLead\s*\/>/, `${name} aligns with the rows it describes`)
  }
  const sessionStart = sidebar.indexOf('function SessionRow')
  const sessionEnd = sidebar.indexOf('\nfunction ', sessionStart + 1)
  assert.ok(sessionStart >= 0 && sessionEnd > sessionStart, 'SessionRow has an enumerable source body')
  assert.match(sidebar.slice(sessionStart, sessionEnd), /<RailEntryLead\s*\/>/, 'sessions do not skip the lead column')

  const partitionStart = sidebar.indexOf('function RailListPartition')
  const partitionEnd = sidebar.indexOf('\nfunction ', partitionStart + 1)
  assert.ok(partitionStart >= 0 && partitionEnd > partitionStart, 'RailListPartition has an enumerable source body')
  const partition = sidebar.slice(partitionStart, partitionEnd)
  assert.match(partition, /<h3[\s\S]*data-rail-list-heading/, 'a partition is introduced by an ordinary heading')
  assert.match(partition, /<RailEntryLead\s*\/>/, 'the heading keeps the shared lead column')
  assert.match(
    partition,
    /<RailTreeBranch\s+role="list"\s+aria-labelledby=\{headingId\}/,
    'the visible heading owns a semantically named, visibly nested resource list',
  )
  assert.doesNotMatch(sidebar, /function GroupHeader/, 'state labels do not use a one-off tag-like renderer')
})

test('every resource-forest row uses one semantic rhythm without decorative selection bullets', () => {
  const kinds: SidebarEntryKind[] = ['root', 'group', 'item', 'view']
  for (const kind of kinds) {
    const idle = sidebarEntryClass(kind, false)
    assert.match(idle, /min-h-8/, `${kind} rows share the 32px rhythm`)
    assert.match(idle, /rounded-lg/, `${kind} rows share one radius`)
    assert.match(idle, /text-ink-soft/, `${kind} rows share the quiet resting tone`)
  }
  assert.match(sidebarEntryClass('root', false), /text-\[13px\]/)
  assert.match(sidebarEntryClass('item', false), /text-\[13px\]/)
  assert.match(sidebarEntryClass('group', false), /text-\[12px\].*font-medium/)
  assert.match(sidebarEntryClass('view', false), /text-\[12px\]/)
  assert.doesNotMatch(sidebarEntryClass('view', false), /font-medium/)

  for (const [name, source] of [['Sidebar', sidebar], ['SectionTreeChildren', children]] as const) {
    assert.equal(
      source.match(/data-rail-node-row/g)?.length,
      source.match(/data-rail-entry-kind=/g)?.length,
      `${name} gives every rendered tree row an explicit semantic role`,
    )
  }

  assert.doesNotMatch(children, /h-1\.5 w-1\.5[^\n]*rounded-full/, 'generic leaf bullets are absent')
  assert.doesNotMatch(sidebar, /function Dot\(/, 'session selection does not mint a second active marker')
  assert.doesNotMatch(sidebar, /function RoutineDot\(/, 'routine health does not mint a second dot signal')
  assert.match(sidebar, /data-routine-state-group=\{routineState\}/, 'routine state is carried by named lists')
  assert.match(sectionView, /data-routine-lead/, 'the page exposes the routine lead for rendered dot-absence review')
  const scheduledStart = sectionView.indexOf('function ScheduledRow')
  const scheduledEnd = sectionView.indexOf('\nfunction ', scheduledStart + 1)
  assert.ok(scheduledStart >= 0 && scheduledEnd > scheduledStart, 'ScheduledRow has an enumerable source body')
  const scheduledRow = sectionView.slice(scheduledStart, scheduledEnd)
  assert.doesNotMatch(scheduledRow, /const dot\s*=|absolute -bottom-/, 'the page lead has no routine-health dot')
  assert.match(sidebar, /session\.pinned/, 'pin state remains visible metadata')
})

test('standing location, keyboard focus, and toolbar roles have distinct cues', () => {
  assert.match(SIDEBAR_ACTIVE, /before:left-0/, 'location has a persistent marker')
  assert.match(SIDEBAR_FOCUS_WITHIN, /focus-within:bg-/, 'focus washes the row without becoming location')
  assert.doesNotMatch(SIDEBAR_FOCUS_WITHIN, /before:/)
  assert.match(sidebar, /data-rail-toolbar-group="global"/)
  assert.match(sidebar, /data-rail-toolbar-group="view"/)
  assert.match(sidebar, /border-l border-line/, 'pane actions have a visible group boundary')
  assert.match(sidebar, /ariaLabel="Organize pane"/, 'paired disclosure commands share one focused menu')
  assert.match(sidebar, /ariaLabel="Split pane"/, 'paired split directions share one labeled menu')
  assert.match(sidebar, /<PaneActionButtons[\s\S]*?compact/, 'the constrained header selects the compact projection')
})
