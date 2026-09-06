/** S7 locks — FOLLOW, the name-keyed positive twin of the S5 mute
 *  (docs/design/social-layer.md §6).
 *
 *  What this file is defending:
 *   - a follow addresses a PERSON by their public display name, never a tenant id;
 *   - reachability is the D21 publisher-existence rule, so an unreachable name
 *     404s IDENTICALLY to one nobody wears (a follow probe is not an oracle);
 *   - following yourself is refused (it would make every count a lie);
 *   - follow and mute are exclusive — following CLEARS a mute, unfollowing does
 *     NOT restore one;
 *   - a follow rings the followee ONCE and their publishes ring nobody (the
 *     deliberate non-bell: a follower gets the LENS, and access isn't
 *     involvement — D24);
 *   - the Commons stamps `followed` per item, keyed on the ACTOR, so the
 *     Following lens has a server predicate rather than a client guess. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { store } from '../store/index.ts'
import { call } from '../testkit/http.ts'

// The seeded demo world: Ada's namespace publishes, Grace's reads it. Using the
// real seeds (rather than synthetic tenants) is deliberate — reachability is
// computed from actual published rows, so a synthetic pair would be unreachable
// and every assertion below would pass vacuously.
const ADA = 'tenant-acme'
const ADA_NAME = 'Ada Lovelace'
const GRACE = 'tenant-beta'
const GRACE_NAME = 'Grace Hopper'
const STRANGER = 'tenant-follow-stranger'

function resetFollows(tenantId: string) {
  for (const name of store.listFollows(tenantId)) store.setFollow(name, false, tenantId)
}

test('follow: the act is name-keyed, listed for the follower, and reported on the profile', async () => {
  resetFollows(GRACE)
  const res = await call('POST', '/social/follow', { name: ADA_NAME, following: true }, { 'x-tenant-id': GRACE })
  assert.equal(res.status, 200)
  assert.deepEqual(res.json, [ADA_NAME], 'the answer IS the caller’s list')

  const list = await call('GET', '/me/follows', undefined, { 'x-tenant-id': GRACE })
  assert.deepEqual(list.json, [ADA_NAME])

  // The followee's profile reports the relationship viewer-relatively.
  const profile = await call('GET', `/directory/owners/${encodeURIComponent(ADA_NAME)}`, undefined, { 'x-tenant-id': GRACE })
  assert.equal(profile.status, 200)
  assert.equal(profile.json.follow.youFollow, true, 'the viewer’s own relationship rides the projection')
  assert.equal(profile.json.follow.followers >= 1, true)
  // The ROSTER, not a tooltip: each row is a person the viewer can open, and
  // carries the caller's own relationship to them so the row's follow control
  // is the server's answer rather than a client join against /me/follows.
  const row = profile.json.follow.followerList.find((r: any) => r.name === GRACE_NAME)
  assert.ok(row, 'a follower the viewer can see is listed')
  assert.equal(row.own, true, 'the caller’s own row is marked — you cannot follow yourself')
  assert.equal(row.youFollow, undefined, 'and carries no follow flag')

  // Ada's own view of her profile: she is followed, but `youFollow` is absent —
  // you cannot follow yourself, so the field has nothing to report (INV-9).
  const own = await call('GET', `/directory/owners/${encodeURIComponent(ADA_NAME)}`, undefined, { 'x-tenant-id': ADA })
  assert.equal(own.json.follow.youFollow, undefined)
  assert.equal(own.json.follow.canMessage, undefined, 'nor may you message yourself')

  const off = await call('POST', '/social/follow', { name: ADA_NAME, following: false }, { 'x-tenant-id': GRACE })
  assert.deepEqual(off.json, [], 'unfollow removes it')
})

const MAYA = 'tenant-growthworks'
const MAYA_NAME = 'Maya Chen'

/** Publish `from` → `to` with a note, which is what makes the publisher a
 *  visible IDENTITY to that audience (the D21 publisher-existence rule). Both
 *  roster tests need it: a follower can only follow someone they can SEE, and a
 *  roster only prints names the READER can see — two different visibilities. */
function publish(from: string, to: string, projectId: string) {
  store.applyRelationOp({ kind: 'create-project', projectId, projectName: `Roster ${projectId}`, projectDescription: '' }, from)
  store.createGrant(
    { subject: { kind: 'project', id: projectId }, audience: { kind: 'org', orgId: to }, tier: 'view', note: `${projectId} published.` },
    from,
  )
}

test('the rosters are viewer-FILTERED, and the count still tells the truth', async () => {
  resetFollows(GRACE)
  resetFollows(MAYA)
  // Ada publishes to Maya, so Maya can SEE Ada and may follow her — but Maya
  // publishes nothing to Grace, so Maya is invisible FROM Grace's account.
  // That asymmetry is the whole point: one workspace's follower can be a
  // stranger to another workspace's reader.
  publish(ADA, MAYA, 'p-roster-hidden')
  assert.equal(store.principalReachable(ADA_NAME, MAYA), true, 'precondition: Maya can see Ada')
  assert.equal(store.principalReachable(MAYA_NAME, GRACE), false, 'precondition: Grace cannot see Maya')
  assert.deepEqual(store.setFollow(ADA_NAME, true, MAYA), [ADA_NAME], 'Maya follows Ada')
  store.setFollow(ADA_NAME, true, GRACE)

  const asGrace = await call('GET', `/directory/owners/${encodeURIComponent(ADA_NAME)}`, undefined, { 'x-tenant-id': GRACE })
  const face = asGrace.json.follow
  const names = face.followerList.map((r: any) => r.name)
  assert.ok(names.includes(GRACE_NAME), 'a follower the viewer can see is listed')
  assert.equal(names.includes(MAYA_NAME), false, 'one they cannot see is NOT — a roster is no back door to the directory')
  // The count stays the whole truth even though the list is a subset: shrinking
  // the number to match would misreport a public fact in order to hide a
  // private one. "N, of which you can see these" is the honest shape.
  assert.ok(face.followers > face.followerList.length, 'the count exceeds what this viewer may see')

  resetFollows(MAYA)
  resetFollows(GRACE)
})

test('a roster row carries the CALLER’s relationship, so its follow control is not a client guess', async () => {
  resetFollows(GRACE)
  resetFollows(MAYA)
  // Now Maya publishes to Grace too, so Maya IS visible from Grace's account
  // and earns a row on Ada's follower list.
  publish(ADA, MAYA, 'p-roster-vis-a')
  publish(MAYA, GRACE, 'p-roster-vis-b')
  store.setFollow(ADA_NAME, true, MAYA)

  const before = await call('GET', `/directory/owners/${encodeURIComponent(ADA_NAME)}`, undefined, { 'x-tenant-id': GRACE })
  const mayaBefore = before.json.follow.followerList.find((r: any) => r.name === MAYA_NAME)
  assert.ok(mayaBefore, 'Maya follows Ada and is visible to Grace, so she has a row')
  assert.equal(mayaBefore.youFollow, undefined, 'Grace does not follow Maya yet (INV-9: absent = no)')

  store.setFollow(MAYA_NAME, true, GRACE)
  const after = await call('GET', `/directory/owners/${encodeURIComponent(ADA_NAME)}`, undefined, { 'x-tenant-id': GRACE })
  const mayaAfter = after.json.follow.followerList.find((r: any) => r.name === MAYA_NAME)
  assert.equal(mayaAfter.youFollow, true, 'the SAME row now reports the caller’s own relationship')

  resetFollows(GRACE)
  resetFollows(MAYA)
})

test('your OWN profile always serves — existence-hiding points outward, never at you', async () => {
  // A workspace with nothing public is invisible to everyone else (that is the
  // D21 rule and it still holds, asserted below) — but it must still be able to
  // open its own page, because that is where "who follows me" lives. Found by
  // S7's own roster: clicking your row on a follower list landed on "shares
  // nothing publicly — or doesn't exist", about yourself.
  const LONER = 'tenant-follow-loner'
  const mine = await call('GET', `/directory/owners/${encodeURIComponent(LONER)}`, undefined, { 'x-tenant-id': LONER })
  assert.equal(mine.status, 200, 'a workspace can always read its own profile')
  assert.equal(mine.json.own, true)
  assert.deepEqual(mine.json.follow.followerList, [], 'empty, and honestly so')
  assert.equal(mine.json.follow.youFollow, undefined, 'no follow control on your own page')
  assert.equal(mine.json.follow.canMessage, undefined, 'nor a message door')

  const theirs = await call('GET', `/directory/owners/${encodeURIComponent(LONER)}`, undefined, { 'x-tenant-id': STRANGER })
  assert.equal(theirs.status, 404, 'and it stays invisible to everyone else')
})

test('follow: an unreachable name 404s identically to a name nobody wears (existence-hiding)', async () => {
  const invisible = await call('POST', '/social/follow', { name: ADA_NAME, following: true }, { 'x-tenant-id': STRANGER })
  const ghost = await call('POST', '/social/follow', { name: 'No Such Workspace', following: true }, { 'x-tenant-id': STRANGER })
  assert.equal(invisible.status, 404, 'a stranger cannot see Ada, so they cannot follow her')
  assert.equal(ghost.status, 404)
  // The two must be INDISTINGUISHABLE apart from the echoed name — otherwise
  // the pair of responses tells a stranger which workspaces exist.
  const shape = (r: { json: { error?: { message?: string }; message?: string } }, name: string) =>
    (r.json.error?.message ?? r.json.message ?? '').replace(name, '<name>')
  assert.equal(shape(invisible, ADA_NAME), shape(ghost, 'No Such Workspace'))
})

test('follow: following yourself is refused', async () => {
  const res = await call('POST', '/social/follow', { name: ADA_NAME, following: true }, { 'x-tenant-id': ADA })
  assert.equal(res.status, 400)
  assert.deepEqual(store.listFollows(ADA), [], 'and nothing was stored')
})

test('follow and mute are exclusive: following clears the earmuff, unfollowing does not restore it', () => {
  resetFollows(GRACE)
  store.setMute(ADA_NAME, true, GRACE)
  assert.ok(store.listMutes(GRACE).includes(ADA_NAME))

  store.setFollow(ADA_NAME, true, GRACE)
  assert.equal(store.listMutes(GRACE).includes(ADA_NAME), false, 'an explicit "show me this person" beats a stale earmuff')

  store.setFollow(ADA_NAME, false, GRACE)
  assert.equal(store.listMutes(GRACE).includes(ADA_NAME), false, 'unfollowing must not silently re-mute — that is the same defect inverted')
})

test('follow rings the followee once; their PUBLISHES ring nobody (the deliberate non-bell)', () => {
  resetFollows(GRACE)
  const before = store.listNotifications(ADA).length
  store.setFollow(ADA_NAME, true, GRACE)
  const rows = store.listNotifications(ADA)
  assert.equal(rows.length, before + 1, 'exactly one bell')
  assert.equal(rows[0].kind, 'social.followed')
  assert.equal(rows[0].actor, GRACE_NAME, 'the row carries the public display name')

  const repeatedEvents: string[] = []
  const unsubscribe = store.subscribe((event) => repeatedEvents.push(event.type))
  store.setFollow(ADA_NAME, true, GRACE)
  unsubscribe()
  assert.equal(store.listNotifications(ADA).length, before + 1, 'same desired-state retry cannot ring twice')
  assert.equal(repeatedEvents.includes('follow.changed'), false, 'same desired state emits no fictional change')

  // Unfollowing is not news — a bell for it would be noise about a decision
  // that is nobody's business but the follower's.
  store.setFollow(ADA_NAME, false, GRACE)
  assert.equal(store.listNotifications(ADA).length, before + 1, 'an unfollow rings nobody')

  // And the followee PUBLISHING does not ring the follower: a follower gets
  // the Commons lens, not the bell (D24 — access isn't involvement). Locked
  // because the tempting "engagement" wiring is exactly what §4 rules out.
  store.setFollow(ADA_NAME, true, GRACE)
  const graceBefore = store.listNotifications(GRACE).length
  store.applyRelationOp({ kind: 'create-project', projectId: 'p-follow-publish', projectName: 'Follow publish', projectDescription: '' }, ADA)
  store.createGrant(
    { subject: { kind: 'project', id: 'p-follow-publish' }, audience: { kind: 'org', orgId: GRACE }, tier: 'view', note: 'Fresh off the press' },
    ADA,
  )
  const graceRows = store.listNotifications(GRACE)
  assert.equal(
    graceRows.filter((r) => r.kind === 'social.followed').length,
    0,
    'a publish by someone you follow mints no follow bell',
  )
  // (The SHARE itself still rings, because it addressed Grace directly — that
  // is S5's grant bell, a different act with a different reason.)
  assert.ok(graceRows.length > graceBefore, 'the share bell is unaffected')
})

test('the Commons stamps `followed` on the ACTOR — the Following lens has a server predicate', () => {
  resetFollows(GRACE)
  const before = store.listCommons(GRACE)
  assert.equal(before.every((i) => i.followed === undefined), true, 'absence is the negative (INV-9)')

  store.setFollow(ADA_NAME, true, GRACE)
  const after = store.listCommons(GRACE)
  const byAda = after.filter((i) => i.actor === ADA_NAME)
  assert.ok(byAda.length > 0, 'the seeded world publishes something of Ada’s to Grace')
  assert.equal(byAda.every((i) => i.followed === true), true, 'every item BY a followed actor is stamped')
  assert.equal(
    after.filter((i) => i.actor !== ADA_NAME).every((i) => i.followed === undefined),
    true,
    'and nothing else is — the lens keys on who ACTED, not on the subject',
  )
  resetFollows(GRACE)
})
