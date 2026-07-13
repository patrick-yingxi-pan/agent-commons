/** Every page has ONE canonical URL (src/lib/urlRoutes.ts) — the address-parity
 *  layer: NavLocation(+subview) ↔ path, both directions total where they must be
 *  and null where the address carries no preference. These lock the grammar so a
 *  route can't silently drift from the nav model it projects: round-trips for
 *  every location kind, the reserved-word rule (a registered sub-view id beats a
 *  detail id), percent-encoding, and the null cases (root, unknown paths). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pathForView, viewForPath } from '../src/lib/urlRoutes.ts'
import { SECTION_LABELS, type NavLocation } from '../src/lib/nav.ts'
import { SECTION_SUBVIEWS } from '../src/lib/subviews.ts'
import { DRAFT_ID } from '../src/data/liveSession.ts'
import type { SectionId } from '../src/types.ts'

const section = (over: Partial<Extract<NavLocation, { kind: 'section' }>> = {}): NavLocation => ({
  kind: 'section',
  section: 'projects',
  projectId: null,
  scheduleId: null,
  ownerName: null,
  ...over,
})

test('the draft session is the root; the root parses as "no preference"', () => {
  assert.equal(pathForView({ kind: 'session', sessionId: DRAFT_ID, title: '' }, null), '/')
  // Asymmetric on purpose: a plain boot at / must restore view memory, not force the draft.
  assert.equal(viewForPath('/'), null)
})

test('a session thread round-trips through /s/:id', () => {
  const path = pathForView({ kind: 'session', sessionId: 'c1', title: 'ignored' }, null)
  assert.equal(path, '/s/c1')
  const routed = viewForPath(path)
  assert.deepEqual(routed?.loc, { kind: 'session', sessionId: 'c1', title: '' })
  assert.equal(routed?.subview, null)
})

test('every section list and every registered sub-view round-trips', () => {
  for (const s of Object.keys(SECTION_LABELS) as SectionId[]) {
    const list = viewForPath(pathForView(section({ section: s }), null))
    assert.deepEqual(list, { loc: section({ section: s }), subview: null }, s)
    for (const sub of SECTION_SUBVIEWS[s] ?? []) {
      const routed = viewForPath(pathForView(section({ section: s }), sub.id))
      assert.deepEqual(routed, { loc: section({ section: s }), subview: sub.id }, `${s}/${sub.id}`)
    }
  }
})

test('project and routine details round-trip; sub-view ids are reserved words', () => {
  const proj = viewForPath(pathForView(section({ projectId: 'p_42' }), null))
  assert.deepEqual(proj, { loc: section({ projectId: 'p_42' }), subview: null })
  const sched = viewForPath(pathForView(section({ section: 'scheduled', scheduleId: 'sch_1' }), null))
  assert.deepEqual(sched, { loc: section({ section: 'scheduled', scheduleId: 'sch_1' }), subview: null })
  // /projects/mine is the "Yours" facet, never a project whose id collides with it.
  assert.deepEqual(viewForPath('/projects/mine'), { loc: section(), subview: 'mine' })
})

test('a work item page round-trips through /projects/:id/work/:itemId', () => {
  const loc = section({ projectId: 'p_42', workItemId: 'osg_7' })
  const path = pathForView(loc, null)
  assert.equal(path, '/projects/p_42/work/osg_7')
  assert.deepEqual(viewForPath(path), { loc: { ...loc, workItemId: 'osg_7' }, subview: null })
  // The nested form exists only under projects, and only with the /work/ segment.
  assert.equal(viewForPath('/scheduled/s1/work/x'), null)
  assert.equal(viewForPath('/projects/p_42/other/x'), null)
  assert.equal(viewForPath('/projects/p_42/work/'), null)
})

test('a workspace profile lives under /u/ and survives names needing encoding', () => {
  const loc = section({ section: 'agents', ownerName: 'Acme, Inc.' })
  const path = pathForView(loc, null)
  assert.equal(path, `/u/${encodeURIComponent('Acme, Inc.')}`)
  assert.deepEqual(viewForPath(path), { loc, subview: null })
})

test('addresses the app does not serve parse to null (stay on the default, never guess)', () => {
  for (const p of ['/nope', '/projects/p_1/extra', '/s', '/s/', '/u', '/u/', '/artifacts/doc/x', '/models/whatever']) {
    assert.equal(viewForPath(p), null, p)
  }
})

test('a detail id that needs encoding round-trips', () => {
  const loc = section({ projectId: 'p one/two' })
  const routed = viewForPath(pathForView(loc, null))
  assert.deepEqual(routed, { loc, subview: null })
})
