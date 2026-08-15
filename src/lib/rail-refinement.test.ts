/** UI-32 — the left panel is one legible resource forest, not an inventory
 * plus duplicated utility panes. These source locks enumerate the funnels that
 * make depth, location, leaf density, and toolbar roles consistent. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { ROOT, read, stripComments } from '../../tests/helpers/source.ts'
import { SECTION_INSTANCE_KEY } from './subviews.ts'
import { SIDEBAR_ACTIVE, SIDEBAR_BRANCH, SIDEBAR_FOCUS_WITHIN } from './sidebar.ts'

const sidebar = stripComments(read(join(ROOT, 'src', 'components', 'Sidebar.tsx')))
const children = stripComments(read(join(ROOT, 'src', 'components', 'SectionTreeChildren.tsx')))

test('Scheduled is one instance branch in Sections, never a duplicate pane', () => {
  assert.equal(SECTION_INSTANCE_KEY.scheduled, 'scheduleId')
  assert.match(sidebar, /id === 'scheduled' \? \(\s*<ScheduledTreeChildren/)
  assert.match(sidebar, /<ScheduledFilterMenu/)
  assert.doesNotMatch(sidebar, /data-rail-pane="scheduled"|Resize Scheduled pane|railScheduledH|schedOpen/)
  assert.match(sidebar, /getLayout\('railRecentsOpen', false\)/, 'the utility history starts subordinate')
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
  assert.doesNotMatch(row, /kind\??:|\{kind &&|depth\??:/)
  assert.match(row, /min-w-0 flex-1 truncate text-left/, 'the resource name owns remaining width')
})

test('standing location, keyboard focus, and toolbar roles have distinct cues', () => {
  assert.match(SIDEBAR_ACTIVE, /before:left-0/, 'location has a persistent marker')
  assert.match(SIDEBAR_FOCUS_WITHIN, /focus-within:bg-/, 'focus washes the row without becoming location')
  assert.doesNotMatch(SIDEBAR_FOCUS_WITHIN, /before:/)
  assert.match(sidebar, /data-rail-toolbar-group="global"/)
  assert.match(sidebar, /data-rail-toolbar-group="view"/)
  assert.match(sidebar, /border-l border-line/, 'pane actions have a visible group boundary')
})
