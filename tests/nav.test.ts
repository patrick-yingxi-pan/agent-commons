/** Navigation history (src/lib/nav.ts): "back" follows where you came from, not a
 *  fixed structural parent. These lock the pure helpers the controller's history
 *  stack is built on — identity equality, the push/dedupe rule, a multi-hop
 *  push→pop sequence, and the destination-naming label. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sameLocation, pushLocation, resolveBackLabel, SECTION_LABELS, type NavLocation } from '../src/lib/nav.ts'
import type { SectionId } from '../src/types.ts'

const session = (id: string, title = id): NavLocation => ({ kind: 'session', sessionId: id, title })
const list = (section: SectionId): NavLocation => ({ kind: 'section', section, projectId: null, scheduleId: null })
const projectDetail = (id: string): NavLocation => ({ kind: 'section', section: 'projects', projectId: id, scheduleId: null })
const routineDetail = (id: string): NavLocation => ({ kind: 'section', section: 'scheduled', projectId: null, scheduleId: id })

test('sameLocation compares page identity, ignoring a session title', () => {
  assert.ok(sameLocation(session('s1', 'Old title'), session('s1', 'New title')), 'same session id ⇒ same page')
  assert.ok(!sameLocation(session('s1'), session('s2')))
  assert.ok(sameLocation(projectDetail('p1'), projectDetail('p1')))
  assert.ok(!sameLocation(projectDetail('p1'), projectDetail('p2')))
  assert.ok(!sameLocation(projectDetail('p1'), list('projects')), 'the list and a detail are different pages')
  assert.ok(!sameLocation(session('s1'), list('projects')))
})

test('pushLocation records the page being left', () => {
  const h = pushLocation([], session('s1'), projectDetail('p1'))
  assert.deepEqual(h.map((l) => (l.kind === 'session' ? l.sessionId : l.projectId)), ['s1'])
})

test('pushLocation skips a no-op hop (leaving === arriving)', () => {
  const h = pushLocation([list('projects')], list('projects'), list('projects'))
  assert.equal(h.length, 1, 're-opening the page you are on adds nothing')
})

test('pushLocation skips a consecutive duplicate of the current top', () => {
  const start = [session('s1')]
  const h = pushLocation(start, session('s1'), projectDetail('p1'))
  assert.equal(h.length, 1, 'leaving a page already on top of the stack does not double it')
})

test('a multi-hop trail pops back in reverse order', () => {
  // session → project detail → routine detail, then back, back.
  let h: NavLocation[] = []
  h = pushLocation(h, session('s1'), projectDetail('p1')) // at p1
  h = pushLocation(h, projectDetail('p1'), routineDetail('r1')) // at r1
  assert.deepEqual(h, [session('s1'), projectDetail('p1')])
  // back: pop → returns to p1
  const backTo1 = h[h.length - 1]
  h = h.slice(0, -1)
  assert.ok(sameLocation(backTo1, projectDetail('p1')))
  // back again: pop → returns to the session
  const backTo2 = h[h.length - 1]
  h = h.slice(0, -1)
  assert.ok(sameLocation(backTo2, session('s1')))
  assert.equal(h.length, 0, 'the trail is exhausted')
})

test('resolveBackLabel names the destination', () => {
  assert.equal(resolveBackLabel(session('s1', 'Insights dashboard launch')), 'Insights dashboard launch')
  assert.equal(resolveBackLabel(projectDetail('p1'), { project: { p1: 'Q4 launch planning' } }), 'Q4 launch planning')
  assert.equal(resolveBackLabel(routineDetail('r1'), { schedule: { r1: 'Daily news briefing' } }), 'Daily news briefing')
  assert.equal(resolveBackLabel(list('scheduled')), SECTION_LABELS.scheduled, 'a bare section uses its list name')
})

test('resolveBackLabel falls back gracefully when a name is missing', () => {
  assert.equal(resolveBackLabel(null), 'Back')
  assert.equal(resolveBackLabel(session('s1', '')), 'Back', 'an empty title is not shown')
  assert.equal(resolveBackLabel(projectDetail('p9'), {}), SECTION_LABELS.projects, 'unknown project ⇒ section name')
  assert.equal(resolveBackLabel(routineDetail('r9'), {}), SECTION_LABELS.scheduled)
})
