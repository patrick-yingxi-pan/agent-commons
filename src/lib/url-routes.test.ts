/** Every page has ONE canonical URL (src/lib/urlRoutes.ts) — the address-parity
 *  layer: NavLocation(+subview) ↔ path, both directions total where they must be
 *  and null where the address carries no preference. These lock the grammar so a
 *  route can't silently drift from the nav model it projects: round-trips for
 *  every location kind, the reserved-word rule (a registered sub-view id beats a
 *  detail id), percent-encoding, and the null cases (root, unknown paths). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pathForView, viewForPath } from './urlRoutes.ts'
import { SECTION_LABELS, type NavLocation } from './nav.ts'
import { OWNER_SECTION } from './paneNav.ts'
import { SECTION_INSTANCE_KEY, SECTION_SUBVIEWS } from './subviews.ts'
import { DRAFT_ID } from '../data/liveSession.ts'
import type { SectionId } from '../types.ts'

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

test('project and routine details round-trip', () => {
  const proj = viewForPath(pathForView(section({ projectId: 'p_42' }), null))
  assert.deepEqual(proj, { loc: section({ projectId: 'p_42' }), subview: null })
  const sched = viewForPath(pathForView(section({ section: 'scheduled', scheduleId: 'sch_1' }), null))
  assert.deepEqual(sched, { loc: section({ section: 'scheduled', scheduleId: 'sch_1' }), subview: null })
  // Projects declare no sub-views since the ownership facet moved into the rail
  // row's "Filter & sort" (UI-19), so the whole second segment is id space now:
  // /projects/mine is a project called `mine`, not a reserved facet word.
  assert.deepEqual(viewForPath('/projects/mine'), { loc: section({ projectId: 'mine' }), subview: null })
})

test('every composite section is a canonical page between its parent and resources', async () => {
  const { OWNER_PROFILE_SECTIONS, PROJECT_SECTIONS, SCHEDULE_SECTIONS } = await import('./compositeSections.ts')
  for (const projectSection of PROJECT_SECTIONS) {
    const loc = section({ projectId: 'p_42', projectSectionId: projectSection.id })
    const path = `/projects/p_42/${projectSection.id}`
    assert.equal(pathForView(loc, null), path)
    assert.deepEqual(viewForPath(path), { loc, subview: null })
  }
  for (const routineSection of SCHEDULE_SECTIONS) {
    const loc = section({ section: 'scheduled', scheduleId: 'sch_1', scheduleSectionId: routineSection.id })
    const path = `/scheduled/sch_1/${routineSection.id}`
    assert.equal(pathForView(loc, null), path)
    assert.deepEqual(viewForPath(path), { loc, subview: null })
  }
  for (const profileSection of OWNER_PROFILE_SECTIONS) {
    const loc = section({ section: OWNER_SECTION, ownerName: 'Ada Lovelace', ownerSectionId: profileSection.id })
    const path = `/u/Ada%20Lovelace/${profileSection.id}`
    assert.equal(pathForView(loc, null), path)
    assert.deepEqual(viewForPath(path), { loc, subview: null })
  }
})

test('collection section pages round-trip between the root and canonical rows', async () => {
  const { COLLECTION_SECTION_HOSTS } = await import('./collectionSections.ts')
  for (const host of COLLECTION_SECTION_HOSTS) {
    const loc = section({ section: host, collectionSectionId: 'section one/two' })
    const path = `/${host}/groups/section%20one%2Ftwo`
    assert.equal(pathForView(loc, null), path)
    assert.deepEqual(viewForPath(path), { loc, subview: null })
  }
  assert.equal(viewForPath('/projects/groups/x'), null, 'only declared collection roots own this grammar')
})

test('a collection-section seed cannot mint a group URL under an unrelated host', () => {
  assert.equal(
    pathForView(section({ section: 'projects', collectionSectionId: 'providers' }), null),
    '/projects',
  )
})

test('every kind the rail LISTS is addressable — a rail child is a place (UI-19)', () => {
  // The rail expands a content section to its rows, so each row must have an
  // address to open. Derived from the registry: adding a section to the rail's
  // instance list without giving its rows a URL fails here.
  const EXPECTED: Record<string, string> = {
    projects: 'projectId',
    artifacts: 'artifactId',
    contexts: 'contextId',
    models: 'providerId',
    scheduled: 'scheduleId',
    discussions: 'discussionId',
  }
  assert.deepEqual(SECTION_INSTANCE_KEY, EXPECTED, 'the sections whose rail children are their own rows')
  for (const [sec, key] of Object.entries(SECTION_INSTANCE_KEY)) {
    const s = sec as SectionId
    const loc = section({ section: s, [key]: 'row-1' })
    const path = pathForView(loc, null)
    assert.equal(path, `/${s}/row-1`, `${s} rows address as /${s}/:id`)
    assert.deepEqual(viewForPath(path), { loc, subview: null }, `${s} row round-trips`)
  }
})

test('a work item page round-trips through /projects/:id/work/:itemId', () => {
  const loc = section({ projectId: 'p_42', workItemId: 'osg_7' })
  const path = pathForView(loc, null)
  assert.equal(path, '/projects/p_42/work/osg_7')
  assert.deepEqual(viewForPath(path), {
    loc: { ...loc, projectSectionId: 'open-work', workItemId: 'osg_7' },
    subview: null,
  })
  // The nested form exists only under projects, and only with the /work/ segment.
  assert.equal(viewForPath('/scheduled/s1/work/x'), null)
  assert.equal(viewForPath('/projects/p_42/other/x'), null)
  assert.equal(viewForPath('/projects/p_42/work/'), null)
})

test('a contribution page round-trips through /projects/:id/changes/:cid (workflow Phase A)', () => {
  const loc = section({ projectId: 'p_42', contributionId: 'contrib-7' })
  const path = pathForView(loc, null)
  assert.equal(path, '/projects/p_42/changes/contrib-7')
  assert.deepEqual(viewForPath(path), {
    loc: { ...loc, projectSectionId: 'changes', contributionId: 'contrib-7' },
    subview: null,
  })
  // Its sibling rule: only under projects, only with the /changes/ segment.
  assert.equal(viewForPath('/scheduled/s1/changes/x'), null)
  assert.deepEqual(
    viewForPath('/projects/p_42/changes/'),
    { loc: section({ projectId: 'p_42', projectSectionId: 'changes' }), subview: null },
    'without a contribution id, Changes names the intermediate section page',
  )
})

test('an agent definition page round-trips through /agents/:id; sub-view ids stay reserved', () => {
  const loc = section({ section: 'agents', agentId: 'agent-7' })
  const path = pathForView(loc, null)
  assert.equal(path, '/agents/agent-7')
  assert.deepEqual(viewForPath(path), { loc: { ...loc, agentId: 'agent-7' }, subview: null })
  // /agents/work is the "Your work" sub-view, never an agent whose id collides with it.
  assert.deepEqual(viewForPath('/agents/work'), { loc: section({ section: 'agents' }), subview: 'work' })
})

test('Agent building-block leaves have canonical nested addresses', () => {
  const prompt = section({ section: 'agents', promptId: 'prompt one/two' })
  const promptPath = pathForView(prompt, null)
  assert.equal(promptPath, '/agents/prompts/prompt%20one%2Ftwo')
  assert.deepEqual(viewForPath(promptPath), { loc: prompt, subview: null })

  const tool = section({ section: 'agents', toolId: 'read_file' })
  const toolPath = pathForView(tool, null)
  assert.equal(toolPath, '/agents/tools/read_file')
  assert.deepEqual(viewForPath(toolPath), { loc: tool, subview: null })
})

test('a saved context detail round-trips through /contexts/:id', () => {
  const loc = section({ section: 'contexts', contextId: 'linear' })
  const path = pathForView(loc, null)
  assert.equal(path, '/contexts/linear')
  assert.deepEqual(viewForPath(path), { loc: { ...loc, contextId: 'linear' }, subview: null })
  // The kind facet left the address entirely (UI-19: it is a stored preference,
  // not a page), so /contexts/connector is a context id like any other.
  assert.deepEqual(viewForPath('/contexts/connector'), { loc: section({ section: 'contexts', contextId: 'connector' }), subview: null })
})

test('artifact history revisions have canonical encoded addresses and exact revision parsing', () => {
  const loc = section({ section: 'artifacts', artifactId: 'doc one/two', artifactRevision: '0' })
  const path = pathForView(loc, null)
  assert.equal(path, '/artifacts/doc%20one%2Ftwo/history/0')
  assert.deepEqual(viewForPath(path), { loc, subview: null })
  assert.equal(viewForPath('/artifacts/doc/history/01'), null, 'leading-zero revisions are not canonical')
  assert.equal(viewForPath('/artifacts/doc/history/-1'), null, 'negative revisions are invalid')
  assert.equal(viewForPath('/artifacts/doc/history/9007199254740992'), null, 'unsafe revisions are invalid')
  assert.equal(viewForPath('/artifacts/doc/history/1/extra'), null, 'the history route has one revision segment')
})

test('current and saved Artifact match locators have distinct canonical reload addresses', () => {
  const current = section({ section: 'artifacts', artifactId: 'doc one', artifactMatch: '7/workbook.2.cell.4.5' })
  const currentPath = '/artifacts/doc%20one/match/7/workbook.2.cell.4.5'
  assert.equal(pathForView(current, null), currentPath)
  assert.deepEqual(viewForPath(currentPath), { loc: current, subview: null })

  const saved = section({ section: 'artifacts', artifactId: 'doc one', artifactRevision: '7', artifactMatch: '7/workbook.2.cell.4.5' })
  const savedPath = '/artifacts/doc%20one/history/7/match/workbook.2.cell.4.5'
  assert.equal(pathForView(saved, null), savedPath)
  assert.deepEqual(viewForPath(savedPath), { loc: saved, subview: null })

  for (const path of [
    '/artifacts/doc/match/07/doc.title',
    '/artifacts/doc/match/7/doc.block.00.p',
    '/artifacts/doc/match/7/doc.title/extra',
    '/artifacts/doc/history/7/match/doc.block.00.p',
    '/artifacts/doc/history/7/match/doc.title/extra',
  ]) assert.equal(viewForPath(path), null, `reject malformed/nonmatching address ${path}`)

  assert.equal(pathForView(section({ section: 'artifacts', artifactId: 'doc', artifactMatch: '07/doc.title' }), null), '/artifacts/doc', 'invalid persisted current targets cannot mint an address')
  assert.equal(pathForView(section({ section: 'artifacts', artifactId: 'doc', artifactRevision: '7', artifactMatch: '8/doc.title' }), null), '/artifacts/doc/history/7', 'a target for another revision is dropped from the address')
})

test('a discussion detail round-trips through /discussions/:did', () => {
  const loc = section({ section: 'discussions', discussionId: 'disc-1' })
  const path = pathForView(loc, null)
  assert.equal(path, '/discussions/disc-1')
  assert.deepEqual(viewForPath(path), { loc: { ...loc, discussionId: 'disc-1' }, subview: null })
})

test('an admin account detail round-trips through /admin/users/:id; console subview ids stay reserved', () => {
  const loc = section({ section: 'admin', adminUserId: 'user-grace' })
  const path = pathForView(loc, null)
  assert.equal(path, '/admin/users/user-grace')
  assert.deepEqual(viewForPath(path), { loc: { ...loc, adminUserId: 'user-grace' }, subview: null })
  // /admin/orgs is the Organizations surface, never an entity — the detail is
  // nested under the static `users` segment precisely so it cannot collide.
  assert.deepEqual(viewForPath('/admin/orgs'), { loc: section({ section: 'admin' }), subview: 'orgs' })
  // The nested form exists only under /admin/users/, with an id.
  assert.equal(viewForPath('/admin/tenants/x'), null)
  assert.equal(viewForPath('/admin/users/'), null)
})

test('a namespace profile lives under /u/ and survives names needing encoding', () => {
  // The COMMONS hosts it (OWNER_SECTION) — a profile is a social page, and the
  // rail shows the difference: under the old `agents` host, opening anyone's
  // profile lit and auto-expanded the Agents row.
  const loc = section({ section: OWNER_SECTION, ownerName: 'Ada Lovelace' })
  const path = pathForView(loc, null)
  assert.equal(path, `/u/${encodeURIComponent('Ada Lovelace')}`)
  assert.deepEqual(viewForPath(path), { loc, subview: null })
})

test('the profile has one canonical address tree — never a Commons sub-view alias', () => {
  // The standing-door rule (src/lib/subviews.ts). Registering the row as a
  // Commons sub-view would make `/commons/profile` a second address for the
  // page `/u/:name` already serves, and a reserved sub-view id beats a detail
  // id — so it would also shadow a real owner named "profile". Both halves
  // are asserted, in both directions.
  assert.equal(viewForPath('/commons/profile'), null, 'no second address for the profile page')
  assert.ok(
    !(SECTION_SUBVIEWS.commons ?? []).some((v) => v.id === 'profile'),
    'the profile is not registered as a Commons sub-view',
  )
  // And the door's own address parses to the profile, whoever the owner is.
  assert.deepEqual(viewForPath('/u/Grace%20Hopper'), {
    loc: section({ section: OWNER_SECTION, ownerName: 'Grace Hopper' }),
    subview: null,
  })
  assert.equal(viewForPath('/u/Grace%20Hopper/not-a-section'), null)
})

test('addresses the app does not serve parse to null (stay on the default, never guess)', () => {
  for (const p of ['/nope', '/projects/p_1/extra', '/s', '/s/', '/u', '/u/', '/artifacts/doc/x', '/dispatch/whatever']) {
    assert.equal(viewForPath(p), null, p)
  }
})

test('a detail id that needs encoding round-trips', () => {
  const loc = section({ projectId: 'p one/two' })
  const routed = viewForPath(pathForView(loc, null))
  assert.deepEqual(routed, { loc, subview: null })
})
