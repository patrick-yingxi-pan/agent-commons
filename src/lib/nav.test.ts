/** Navigation history (src/lib/nav.ts): "back" follows where you came from, not a
 *  fixed structural parent. These lock the pure helpers the controller's history
 *  stack is built on — identity equality, the push/dedupe rule, a multi-hop
 *  push→pop sequence, and the destination-naming label. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sameLocation, pushLocation, resolveBackLabel, SECTION_LABELS, type BackLabelNames, type NavLocation } from './nav.ts'
import { PANE_SEED_KEYS } from './paneNav.ts'
import { BACK_LABEL_SOURCES } from './nav.ts'
import { join } from 'node:path'
import { ROOT, concatSource, read, stripComments } from '../../tests/helpers/source.ts'
import type { SectionId } from '../types.ts'

const session = (id: string, title = id): NavLocation => ({ kind: 'session', sessionId: id, title })
const list = (section: SectionId): NavLocation => ({ kind: 'section', section, projectId: null, scheduleId: null })
const projectDetail = (id: string): NavLocation => ({ kind: 'section', section: 'projects', projectId: id, scheduleId: null })
const routineDetail = (id: string): NavLocation => ({ kind: 'section', section: 'scheduled', projectId: null, scheduleId: id })
const ownerProfile = (name: string): NavLocation => ({ kind: 'section', section: 'agents', projectId: null, scheduleId: null, ownerName: name })
const adminUserDetail = (id: string): NavLocation => ({ kind: 'section', section: 'admin', projectId: null, scheduleId: null, adminUserId: id })

test('sameLocation compares page identity, ignoring a session title', () => {
  assert.ok(sameLocation(session('s1', 'Old title'), session('s1', 'New title')), 'same session id ⇒ same page')
  assert.ok(!sameLocation(session('s1'), session('s2')))
  assert.ok(sameLocation(projectDetail('p1'), projectDetail('p1')))
  assert.ok(!sameLocation(projectDetail('p1'), projectDetail('p2')))
  assert.ok(!sameLocation(projectDetail('p1'), list('projects')), 'the list and a detail are different pages')
  assert.ok(!sameLocation(session('s1'), list('projects')))
  // The workspace profile (D21) is a detail of the agents section, keyed by name.
  assert.ok(sameLocation(ownerProfile('Ada Lab'), ownerProfile('Ada Lab')))
  assert.ok(!sameLocation(ownerProfile('Ada Lab'), ownerProfile('Bo Studio')))
  assert.ok(!sameLocation(ownerProfile('Ada Lab'), list('agents')), 'a profile and the hub are different pages')
  // The maintainer console's account detail (FWD-7 v1.1) is keyed by user id.
  assert.ok(sameLocation(adminUserDetail('user-grace'), adminUserDetail('user-grace')))
  assert.ok(!sameLocation(adminUserDetail('user-grace'), adminUserDetail('user-ada')))
  assert.ok(!sameLocation(adminUserDetail('user-grace'), list('admin')), 'a detail and the console are different pages')
  // An old location literal without the field ≡ one with it null (history compat).
  assert.ok(sameLocation({ kind: 'section', section: 'agents', projectId: null, scheduleId: null }, list('agents')))
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
  assert.equal(resolveBackLabel(ownerProfile('Ada Lab')), 'Ada Lab', 'a workspace profile is its own label (D21)')
})

test('resolveBackLabel falls back gracefully when a name is missing', () => {
  assert.equal(resolveBackLabel(null), 'Back')
  assert.equal(resolveBackLabel(session('s1', '')), 'Back', 'an empty title is not shown')
  assert.equal(resolveBackLabel(projectDetail('p9'), {}), SECTION_LABELS.projects, 'unknown project ⇒ section name')
  assert.equal(resolveBackLabel(routineDetail('r9'), {}), SECTION_LABELS.scheduled)
})

test('EVERY detail kind names itself — a back label never says the section for a page', () => {
  // The defect this locks, found walking the byline door (2026-08-09): back
  // from a profile to the THREAD you came from landed correctly on
  // /discussions/disc-seed-1 and announced "Back to Discussions". The label
  // named only project / schedule / owner, and every other detail kind fell
  // silently through to its section — so the control's tooltip and its
  // accessible name (WCAG 4.1.2) described a page other than the one it opens.
  //
  // Enumerated from PANE_SEED_KEYS rather than hand-listed, so a NEW detail
  // kind fails here until it is given a name (the compiler already forces a
  // DETAIL_LABEL entry; this forces the entry to be a decision, not a stub).
  const NAMED: Partial<Record<(typeof PANE_SEED_KEYS)[number], { section: SectionId; names: BackLabelNames; want: string; id?: string }>> = {
    collectionSectionId: { section: 'artifacts', names: { project: { x: 'Insights dashboard' } }, want: 'Insights dashboard' },
    projectSectionId: { section: 'projects', names: {}, want: 'About', id: 'about' },
    projectId: { section: 'projects', names: { project: { x: 'Q4 launch planning' } }, want: 'Q4 launch planning' },
    scheduleSectionId: { section: 'scheduled', names: {}, want: 'Workflow', id: 'workflow' },
    scheduleId: { section: 'scheduled', names: { schedule: { x: 'Daily news briefing' } }, want: 'Daily news briefing' },
    ownerName: { section: 'commons', names: {}, want: 'x' },
    agentId: { section: 'agents', names: { agent: { x: 'Atlas Guide' } }, want: 'Atlas Guide' },
    promptId: { section: 'agents', names: { prompt: { x: 'Careful reviewer' } }, want: 'Careful reviewer' },
    toolId: { section: 'agents', names: { tool: { x: 'Open Workspace' } }, want: 'Open Workspace' },
    contextId: { section: 'contexts', names: { context: { x: 'acme/insights' } }, want: 'acme/insights' },
    discussionId: { section: 'discussions', names: { discussion: { x: 'Is the retention cut…' } }, want: 'Is the retention cut…' },
    artifactId: { section: 'artifacts', names: { artifact: { x: 'Launch brief' } }, want: 'Launch brief' },
    providerId: { section: 'models', names: { provider: { x: 'Together' } }, want: 'Together' },
  }
  // The two deliberate abstentions, each with its reason in DETAIL_LABEL: a
  // work item / contribution is NESTED under a structural Project section
  // (which the walk reaches first — asserted below), and the
  // console's account roster is grant-walled, so naming it would mean a
  // cross-tenant read from every page in the app.
  const UNNAMED = ['workItemId', 'contributionId', 'adminUserId'] as const
  for (const key of PANE_SEED_KEYS) {
    const spec = NAMED[key]
    if (!spec) {
      assert.ok(UNNAMED.includes(key as (typeof UNNAMED)[number]), `${key} has no back label and no argued reason to lack one`)
      continue
    }
    const to: NavLocation = { kind: 'section', section: spec.section, projectId: null, scheduleId: null, [key]: spec.id ?? 'x' }
    assert.equal(resolveBackLabel(to, spec.names), spec.want, `${key} names its own page`)
    // …and degrades to the section name when the registry hasn't got it.
    assert.equal(
      resolveBackLabel(to, {}),
      key === 'ownerName' ? 'x'
      : key === 'projectSectionId' || key === 'scheduleSectionId' ? spec.want
      : SECTION_LABELS[spec.section],
      `${key} degrades to its section when unnamed`,
    )
  }
  // A work item's page reads its structural SECTION — the closest named
  // container, which is why the walk follows PANE_SEED_KEYS order rather than
  // the order the branches happen to be written in.
  const workItem: NavLocation = {
    kind: 'section',
    section: 'projects',
    projectId: 'p1',
    projectSectionId: 'open-work',
    scheduleId: null,
    workItemId: 'w1',
  }
  assert.equal(resolveBackLabel(workItem, { project: { p1: 'Q4 launch planning' } }), 'Open work')
})

test('the ONE back control feeds every name source it can be asked for', () => {
  // Totality is half the guarantee: a complete function handed a half-filled
  // map degrades to the section name exactly like the bug, and just as
  // silently. `BackButton` is the sole caller, so the pairing is checkable —
  // enumerated from BACK_LABEL_SOURCES, not from a list written twice.
  const back = stripComments(read(join(ROOT, 'src', 'components', 'BackButton.tsx')))
  for (const source of BACK_LABEL_SOURCES) {
    assert.match(back, new RegExp(`\\b${source}:\\s`), `BackButton supplies no live \`${source}\` names`)
  }
  // Both directions: a source nobody reads is a map built on every render for
  // nothing (and a label case somebody meant to write).
  const nav = stripComments(read(join(ROOT, 'src', 'lib', 'nav.ts')))
  for (const source of BACK_LABEL_SOURCES) {
    assert.ok(nav.includes(`n.${source}?.[id]`), `no DETAIL_LABEL case reads the \`${source}\` names`)
  }
  // And it is the ONE control — the label can't drift because there is nowhere
  // for a second copy to drift from.
  const components = concatSource('src/components')
  assert.equal(
    components.split('resolveBackLabel(').length - 1,
    1,
    'exactly one caller of resolveBackLabel — the shared BackButton',
  )
})
