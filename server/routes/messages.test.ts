/** S7 locks — DIRECT MESSAGES: the Discussion primitive anchored to a PRINCIPAL
 *  (docs/design/social-layer.md §6).
 *
 *  The design claim under test is that a DM needs no new primitive — so these
 *  tests are mostly about the FOUR specializations that make an ordinary
 *  discussion behave like a message, and about the three cells of the
 *  orthogonality matrix that are explicit REFUSALS rather than features:
 *
 *   1. stream identity is the unordered PAIR (get-or-create, either direction);
 *   2. the wall is the pair — not the anchor's visibility, which is much wider;
 *   3. reachability gates who may open one (the profile-existence rule);
 *   4. a DM carries a viewer-relative `counterpart` (the anchor names one end).
 *
 *   refusals: grant × principal, proposal × principal, grant × a DM thread. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from '../../tests/helpers/source.ts'
import { store, recoverDmParties, recoverBellActors, recoverSeedBellActors } from '../store/index.ts'
import { call } from '../testkit/http.ts'

// The seeded world — see server/routes/follows.test.ts for why real seeds, not
// synthetic tenants: reachability is computed from actual published rows.
const ADA = 'tenant-acme'
const ADA_NAME = 'Ada Lovelace'
const GRACE = 'tenant-beta'
const GRACE_NAME = 'Grace Hopper'
let n = 0 // unique ids for the hand-built legacy rows below
const STRANGER = 'tenant-dm-stranger'

const dmTo = (name: string, body: string, as: string) =>
  call('POST', '/discussions', { anchor: { ref: { kind: 'principal', id: name } }, firstPost: body }, { 'x-tenant-id': as })

test('a DM is one conversation per PAIR — either end opens the same thread', async () => {
  const opened = await dmTo(ADA_NAME, 'Grace here — is Thursday still good?', GRACE)
  assert.equal(opened.status, 200)
  assert.equal(opened.json.direct, true, 'the wire face says it is a message')
  assert.equal(opened.json.anchor.ref.kind, 'principal')
  // Relative to whatever the conversation already holds — the seeded scene puts
  // real talk in this very thread, and an absolute count would pass only on a
  // world that happened to be empty.
  const base = opened.json.posts.length

  // The OTHER direction resolves to the SAME row. This is the whole trick: the
  // root-thread rule ("one stream per subject") specializes to "one stream per
  // pair", and that single change turns the primitive into a DM inbox.
  const replied = await dmTo(GRACE_NAME, 'Ada here — Thursday works.', ADA)
  assert.equal(replied.status, 200)
  assert.equal(replied.json.id, opened.json.id, 'Ada→Grace and Grace→Ada are ONE conversation')
  assert.equal(replied.json.posts.length, base + 1, 'the second open appended rather than forking a thread')

  // Re-opening from the original side still appends — however many times.
  const again = await dmTo(ADA_NAME, 'Great, see you then.', GRACE)
  assert.equal(again.json.id, opened.json.id)
  assert.equal(again.json.posts.length, base + 2)
  // And exactly ONE principal-anchored thread exists for this pair, however
  // many opens ran above — the property the id equality above only samples.
  const inbox = await call('GET', '/discussions?direct=1', undefined, { 'x-tenant-id': GRACE })
  assert.equal(inbox.json.filter((d: any) => d.counterpart === ADA_NAME).length, 1)
})

test('`counterpart` is viewer-relative — each end sees the OTHER party, never itself', async () => {
  const thread = await dmTo(ADA_NAME, 'counterpart check', GRACE)
  const asGrace = await call('GET', `/discussions/${thread.json.id}`, undefined, { 'x-tenant-id': GRACE })
  const asAda = await call('GET', `/discussions/${thread.json.id}`, undefined, { 'x-tenant-id': ADA })
  assert.equal(asGrace.json.counterpart, ADA_NAME, 'the opener sees whom they wrote to')
  assert.equal(asAda.json.counterpart, GRACE_NAME, 'the recipient sees the sender — NOT the anchored name, which is their own')
})

test('the wall is the PAIR, not the anchor’s visibility (a third party 404s)', async () => {
  const thread = await dmTo(ADA_NAME, 'private words', GRACE)
  // The precondition that gives this test its teeth: Maya must be able to see
  // ADA, so the thread's ANCHOR is visible to her. If a DM inherited its
  // anchor's wall — the S2 rule every other discussion follows — Maya would
  // read the message. The pair rule is the only thing stopping her.
  const MAYA = 'tenant-growthworks'
  store.applyRelationOp({ kind: 'create-project', projectId: 'p-dm-visible', projectName: 'DM visibility', projectDescription: '' }, ADA)
  store.createGrant(
    { subject: { kind: 'project', id: 'p-dm-visible' }, audience: { kind: 'org', orgId: MAYA }, tier: 'view', note: 'Ada publishes to Maya.' },
    ADA,
  )
  assert.equal(store.principalReachable(ADA_NAME, MAYA), true, 'precondition: Maya CAN see Ada')
  const peek = await call('GET', `/discussions/${thread.json.id}`, undefined, { 'x-tenant-id': MAYA })
  const ghost = await call('GET', '/discussions/disc-no-such', undefined, { 'x-tenant-id': MAYA })
  assert.equal(peek.status, 404, 'a visible person’s messages are still private to the pair')
  assert.equal(ghost.status, 404, 'and invisible reads exactly like nonexistent')

  const post = await call('POST', `/discussions/${thread.json.id}/posts`, { body: 'butting in' }, { 'x-tenant-id': MAYA })
  assert.equal(post.status, 404, 'nor may a third party write into it')
})

test('the inbox lists a caller’s DMs and nobody else’s; the discussions hub excludes them', async () => {
  const thread = await dmTo(ADA_NAME, 'inbox check', GRACE)
  const inbox = await call('GET', '/discussions?direct=1', undefined, { 'x-tenant-id': GRACE })
  assert.equal(inbox.status, 200)
  assert.ok(inbox.json.some((d: any) => d.id === thread.json.id), 'the sender’s inbox carries it')
  assert.equal(inbox.json.every((d: any) => d.direct === true), true, 'the inbox is DMs only')

  const adaInbox = await call('GET', '/discussions?direct=1', undefined, { 'x-tenant-id': ADA })
  assert.ok(adaInbox.json.some((d: any) => d.id === thread.json.id), 'the recipient’s inbox carries it too')

  const mayaInbox = await call('GET', '/discussions?direct=1', undefined, { 'x-tenant-id': 'tenant-growthworks' })
  assert.equal(mayaInbox.json.some((d: any) => d.id === thread.json.id), false, 'a non-party’s inbox does not')

  // One row, one list: a DM is a discussion by construction, so it would ride
  // the hub for free — and the same rows in two rail sections is the
  // duplication the rail rules forbid.
  const hub = await call('GET', '/discussions?mine=1', undefined, { 'x-tenant-id': GRACE })
  assert.equal(hub.json.some((d: any) => d.id === thread.json.id), false, 'the Discussions hub is talk ABOUT things')
})

test('reachability gates the door: an unreachable name 404s; anchoring to YOURSELF is a post (S8)', async () => {
  const invisible = await dmTo(ADA_NAME, 'hello?', STRANGER)
  const ghost = await dmTo('No Such Workspace', 'hello?', STRANGER)
  assert.equal(invisible.status, 404, 'a stranger cannot reach Ada')
  assert.equal(ghost.status, 404)
  // S8 changed what a self-anchor MEANS. S7 refused it with a 403 ("there is no
  // existence to hide from yourself"), which was a placeholder: the guard
  // existed to kill a real bug (get-or-create had made the pair predicate
  // trivially true, so a self-addressed note appended to whichever thread
  // matched first), not because the act was meaningless. It now opens a POST on
  // your own wall — and the old bug stays dead by construction, because a post
  // never looks a thread up: every one is new.
  const self = await dmTo(ADA_NAME, 'note to self', ADA)
  assert.equal(self.status, 200, 'a self-anchor is a post, not a refusal')
  assert.equal(self.json.wall, true, 'and it wears the wall face, not the DM face')
  assert.equal(self.json.direct, undefined, 'the two faces are mutually exclusive')
  // Two posts are two threads — the opposite identity rule from a DM's pair
  // get-or-create, and the reason the old collision cannot come back.
  const second = await dmTo(ADA_NAME, 'a second thought', ADA)
  assert.equal(second.status, 200)
  assert.notEqual(second.json.id, self.json.id, 'each utterance is its own thread')
})

test('reachability is ASYMMETRIC, and a received message is standing to reply', async () => {
  // Ada publishes, so Grace can reach her. The reverse need not hold — and in
  // the seeded world it does not. This is the case that would have shipped
  // broken: gating the whole open on reachability let Grace start a
  // conversation Ada could not answer, a one-way message.
  assert.equal(store.principalReachable(ADA_NAME, GRACE), true, 'Grace can reach Ada')
  assert.equal(store.principalReachable(GRACE_NAME, ADA), false, 'Ada cannot cold-open to Grace')

  const opened = await dmTo(ADA_NAME, 'Grace opens the channel', GRACE)
  assert.equal(opened.status, 200)
  const reply = await call('POST', `/discussions/${opened.json.id}/posts`, { body: 'Ada replies' }, { 'x-tenant-id': ADA })
  assert.equal(reply.status, 200, 'being written to is standing to write back')
  // …and the reply also resolves through the pair get-or-create, so Ada
  // "opening" a DM to Grace lands in the very same thread rather than 404ing.
  const viaOpen = await dmTo(GRACE_NAME, 'Ada again, via the open door', ADA)
  assert.equal(viaOpen.status, 200)
  assert.equal(viaOpen.json.id, opened.json.id)
})

// Ada↔Grace is ONE conversation for the whole file (that is the pair rule), so
// these two tests measure DELTAS around a single act rather than assuming a
// fresh thread — a fresh-thread assumption passes only on the first run, which
// is the vacuous-lock trap tests/CLAUDE.md warns about.
const messagedOn = (tenantId: string, discussionId: string) =>
  store.listNotifications(tenantId).filter((n) => n.kind === 'social.messaged' && n.discussionId === discussionId).length

test('a DM post rings the OTHER party with `social.messaged`, doored to the thread', async () => {
  const thread = await dmTo(ADA_NAME, 'ring check — opening', GRACE)
  const id = thread.json.id
  const adaBefore = messagedOn(ADA, id)
  const graceBefore = messagedOn(GRACE, id)

  await call('POST', `/discussions/${id}/posts`, { body: 'ring check — the act under test' }, { 'x-tenant-id': GRACE })

  assert.equal(messagedOn(ADA, id), adaBefore + 1, 'the recipient is rung')
  assert.equal(messagedOn(GRACE, id), graceBefore, 'the sender is never rung by their own message')
  const row = store.listNotifications(ADA).find((n) => n.kind === 'social.messaged' && n.discussionId === id)
  assert.equal(row?.actor, GRACE_NAME, 'the row carries the public display name')
  assert.equal(row?.subjectName, undefined, 'and NOT a subject face — the anchored name is the reader’s own')
  // NOT `social.discussed`: that row's sentence is "someone is talking about
  // your thing", and nobody is discussing the recipient.
  assert.equal(
    store.listNotifications(ADA).some((n) => n.kind === 'social.discussed' && n.discussionId === id),
    false,
  )
})

test('unread is viewer-relative and clears on read; your own words are never unread', async () => {
  const thread = await dmTo(ADA_NAME, 'unread check — opening', GRACE)
  const id = thread.json.id
  // Level the thread for BOTH ends first, so what follows measures this test's
  // own act and not the file's accumulated conversation.
  await call('POST', `/discussions/${id}/read`, {}, { 'x-tenant-id': ADA })
  await call('POST', `/discussions/${id}/read`, {}, { 'x-tenant-id': GRACE })
  const levelled = await call('GET', `/discussions/${id}`, undefined, { 'x-tenant-id': ADA })
  assert.equal(levelled.json.unread, undefined, 'marking read clears it (INV-9: absent = none)')

  await call('POST', `/discussions/${id}/posts`, { body: 'one more from Grace' }, { 'x-tenant-id': GRACE })
  const asAda = await call('GET', `/discussions/${id}`, undefined, { 'x-tenant-id': ADA })
  assert.equal(asAda.json.unread, 1, 'a post from the other side is unread to the recipient')
  const asGrace = await call('GET', `/discussions/${id}`, undefined, { 'x-tenant-id': GRACE })
  assert.equal(asGrace.json.unread, undefined, 'and never to its own author')
})

test('a DM has no resolved state — neither party may close a conversation', async () => {
  const thread = await dmTo(ADA_NAME, 'resolve check', GRACE)
  const id = thread.json.id
  // Neither end, not even the opener: `canResolve` is opener-or-anchor-owner
  // everywhere else, which on a DM would let ONE party mark a two-party
  // conversation finished while the other could not reopen it. Found in the
  // in-app pass — the control was rendering for Grace and for nobody else.
  for (const [who, as] of [['opener', GRACE], ['recipient', ADA]] as const) {
    const face = await call('GET', `/discussions/${id}`, undefined, { 'x-tenant-id': as })
    assert.equal(face.json.canResolve, undefined, `no resolve affordance for the ${who}`)
    const attempt = await call('POST', `/discussions/${id}/resolve`, { state: 'resolved' }, { 'x-tenant-id': as })
    assert.equal(attempt.status, 403, `and the write path refuses the ${who} too`)
  }
  const after = await call('GET', `/discussions/${id}`, undefined, { 'x-tenant-id': GRACE })
  assert.equal(after.json.state, 'open')
})

/** A DM's wall is AUTHORITY, and this repo's earned rule is that authority never
 *  keys on a display name — names are not identities (`createUser` guards
 *  uniqueness on EMAIL, not name, so two workspaces can wear the same one).
 *  The anchor still carries the name, because that is the public face every
 *  social payload wears; what must not be re-derived from it is who the two
 *  parties ARE. Found reviewing S7's own diff: `dmParties` resolved the target
 *  by name at read time, so a later signup could shift an existing private
 *  conversation onto itself. */
test('a same-named signup cannot move an existing conversation’s wall', async () => {
  const { accounts } = await import('../accounts.ts')
  // The target is an ORG (not anyone's namespace) whose member can reach it —
  // chosen because `tenantIdForName` PREFERS a namespace, so a later same-named
  // account would win the name lookup. That is what makes this test able to
  // fail: with the old name-resolving wall it does.
  const founder = accounts.createUser('S7 Founder', `s7-founder-${Date.now()}@example.test`, 'pw-s7-founder')
  assert.ok(founder)
  const org = accounts.createOrg(founder!.user.id, 'Seven Seas Ltd')
  assert.ok(org, 'the org exists and is nobody’s namespace')
  assert.equal(accounts.isNamespace(org!.id), false)

  // The founder can see their own org's profile (the FWD-6 seat branch), so the
  // name is reachable and a DM to it opens.
  const opened = await dmTo('Seven Seas Ltd', 'opening a channel to the org', founder!.tenant.id)
  assert.equal(opened.status, 200, 'the founder can message the org they hold a seat in')
  const id = opened.json.id

  // Now the impostor: a personal account wearing the very same display name.
  // Its tenant IS a namespace, so `tenantIdForName('Seven Seas Ltd')` now
  // answers with the IMPOSTOR rather than the org.
  const impostor = accounts.createUser('Seven Seas Ltd', `s7-impostor-${Date.now()}@example.test`, 'pw-s7-impostor')
  assert.ok(impostor)
  assert.equal(accounts.isNamespace(impostor!.tenant.id), true)

  // The wall is unmoved: the impostor cannot read the conversation, and the
  // original parties still can.
  const peek = await call('GET', `/discussions/${id}`, undefined, { 'x-tenant-id': impostor!.tenant.id })
  assert.equal(peek.status, 404, 'taking the name does not take the conversation')
  const stillMine = await call('GET', `/discussions/${id}`, undefined, { 'x-tenant-id': founder!.tenant.id })
  assert.equal(stillMine.status, 200, 'and the real party keeps it')
  const inbox = await call('GET', '/discussions?direct=1', undefined, { 'x-tenant-id': impostor!.tenant.id })
  assert.equal(inbox.json.some((d: any) => d.id === id), false, 'nor does it appear in their inbox')
})

/** ── Review fixes (2026-08-07) ───────────────────────────────────────────────
 *  Each of these locks a defect the review of S7's own diff turned up. */

test('the read mark survives a DELETED post — unread is a moment, not an index', async () => {
  const thread = await dmTo(ADA_NAME, 'deletion check — opening', GRACE)
  const id = thread.json.id
  await call('POST', `/discussions/${id}/read`, {}, { 'x-tenant-id': ADA })
  assert.equal((await call('GET', `/discussions/${id}`, undefined, { 'x-tenant-id': ADA })).json.unread, undefined)

  // Grace retracts one of her OWN posts, shrinking the array under Ada's mark…
  const mine = (await call('GET', `/discussions/${id}`, undefined, { 'x-tenant-id': GRACE })).json
  const own = mine.posts.filter((p: any) => p.mine === true)
  assert.ok(own.length >= 2, 'Grace has posts of her own to retract')
  const del = await call('DELETE', `/discussions/${id}/posts/${own[0].id}`, undefined, { 'x-tenant-id': GRACE })
  assert.equal(del.status, 200)

  // …then sends two new ones. A count-based mark would slice at a stale index
  // and report ONE; a moment-based mark reports both.
  await call('POST', `/discussions/${id}/posts`, { body: 'after the deletion 1' }, { 'x-tenant-id': GRACE })
  await call('POST', `/discussions/${id}/posts`, { body: 'after the deletion 2' }, { 'x-tenant-id': GRACE })
  const face = await call('GET', `/discussions/${id}`, undefined, { 'x-tenant-id': ADA })
  assert.equal(face.json.unread, 2, 'both new messages are unread despite the deletion')
})

test('`throughPostId` marks read up to ONE post; a foreign id is refused, and the mark never rewinds', async () => {
  const thread = await dmTo(ADA_NAME, 'partial read — opening', GRACE)
  const id = thread.json.id
  await call('POST', `/discussions/${id}/read`, {}, { 'x-tenant-id': ADA })
  await call('POST', `/discussions/${id}/posts`, { body: 'partial A' }, { 'x-tenant-id': GRACE })
  const two = await call('POST', `/discussions/${id}/posts`, { body: 'partial B' }, { 'x-tenant-id': GRACE })
  const posts = two.json.posts
  const a = posts[posts.length - 2]
  assert.equal((await call('GET', `/discussions/${id}`, undefined, { 'x-tenant-id': ADA })).json.unread, 2)

  // Read through the FIRST of the two: one remains.
  await call('POST', `/discussions/${id}/read`, { throughPostId: a.id }, { 'x-tenant-id': ADA })
  assert.equal((await call('GET', `/discussions/${id}`, undefined, { 'x-tenant-id': ADA })).json.unread, 1)

  // Re-sending the older id must NOT rewind the mark (a stale client would
  // otherwise resurrect messages already seen).
  await call('POST', `/discussions/${id}/read`, {}, { 'x-tenant-id': ADA })
  await call('POST', `/discussions/${id}/read`, { throughPostId: a.id }, { 'x-tenant-id': ADA })
  assert.equal((await call('GET', `/discussions/${id}`, undefined, { 'x-tenant-id': ADA })).json.unread, undefined)

  // A post id from another thread marks NOTHING — widening it to "all read"
  // would hide messages the caller never asked to dismiss.
  const other = await call('GET', '/discussions?mine=1', undefined, { 'x-tenant-id': ADA })
  const foreign = other.json.find((d: any) => d.id !== id)?.posts?.[0]?.id
  if (foreign) {
    await call('POST', `/discussions/${id}/posts`, { body: 'still unread' }, { 'x-tenant-id': GRACE })
    await call('POST', `/discussions/${id}/read`, { throughPostId: foreign }, { 'x-tenant-id': ADA })
    assert.equal((await call('GET', `/discussions/${id}`, undefined, { 'x-tenant-id': ADA })).json.unread, 1, 'a foreign id is a no-op, not "mark everything"')
  }
})

test('the per-subject thread cap does not apply to a person — a DM is per-PAIR', () => {
  // The cap bounds threads on ONE resource. Counted against a principal it
  // would bound how many DIFFERENT PEOPLE may ever write to someone, since each
  // sender legitimately gets their own thread on the same anchor.
  const src = readFileSync(join(ROOT, 'server', 'store', 'index.ts'), 'utf8')
  const start = src.indexOf('openDiscussion(\n    req: OpenDiscussionRequest')
  const body = src.slice(start, src.indexOf('\n  },', start))
  const capLine = body.indexOf('MAX_DISCUSSIONS_PER_SUBJECT')
  assert.ok(capLine > 0, 'the cap is still applied somewhere in openDiscussion')
  assert.ok(
    body.slice(0, capLine).includes('if (dmTarget === undefined) {'),
    'the per-subject cap is gated to non-principal anchors — a DM is bounded by the pair, not by the subject',
  )
})

test('`canPost` rides the thread, computed by the predicate the write path enforces', async () => {
  const thread = await dmTo(ADA_NAME, 'canPost check', GRACE)
  const id = thread.json.id
  for (const [who, as] of [['sender', GRACE], ['recipient', ADA]] as const) {
    const face = await call('GET', `/discussions/${id}`, undefined, { 'x-tenant-id': as })
    assert.equal(face.json.canPost, true, `the ${who} may post, and the wire says so`)
  }
  // The tier capability endpoint answers a DIFFERENT question on a principal —
  // reachability, which is asymmetric. Ada cannot even READ Grace as a subject
  // (Grace publishes nothing to her), so that endpoint 404s outright: it has no
  // answer to give about a thread Ada is plainly a party to. That mismatch is
  // exactly why the affordance reads `canPost` off the thread instead.
  const cap = await call('GET', `/social/capability?kind=principal&id=${encodeURIComponent(GRACE_NAME)}`, undefined, { 'x-tenant-id': ADA })
  assert.equal(cap.status, 404, 'the subject-tier capability cannot speak for Ada here…')
  const face = await call('GET', `/discussions/${id}`, undefined, { 'x-tenant-id': ADA })
  assert.equal(face.json.canPost, true, '…yet she may certainly reply in the thread she is a party to')
})

test('the profile reports the pair’s existing thread — the client never matches names', async () => {
  const thread = await dmTo(ADA_NAME, 'dmId check', GRACE)
  const profile = await call('GET', `/directory/owners/${encodeURIComponent(ADA_NAME)}`, undefined, { 'x-tenant-id': GRACE })
  assert.equal(profile.json.follow.dmId, thread.json.id, 'the Message control is a door, decided server-side')
  const own = await call('GET', `/directory/owners/${encodeURIComponent(GRACE_NAME)}`, undefined, { 'x-tenant-id': GRACE })
  assert.equal(own.json.follow.dmId, undefined, 'and never on your own profile')
})

/** ── The orthogonality matrix’s three refusals ────────────────────────────────
 *  The design rule (§1) is that every primitive × noun cell must either work
 *  through the generic path or be an EXPLICITLY DOCUMENTED refusal — never an
 *  unhandled case. These lock the three that are refusals, so a future change
 *  that quietly makes one of them "work" fails here instead of shipping. */
test('refusal: you cannot SHARE a person — grant × principal', async () => {
  const res = await call(
    'POST', '/grants',
    { subject: { kind: 'principal', id: ADA_NAME }, audience: { kind: 'org', orgId: GRACE }, tier: 'view' },
    { 'x-tenant-id': ADA },
  )
  assert.equal(res.status, 400, 'a kind-level refusal — access to a human is not a thing a tier expresses')
})

test('refusal: you cannot OFFER A CHANGE to a person — proposal × principal', async () => {
  const res = await call(
    'POST', '/proposals',
    { subject: { kind: 'principal', id: ADA_NAME }, delta: { kind: 'suggestion', text: 'be taller' }, rationale: 'why not' },
    { 'x-tenant-id': GRACE },
  )
  // 403: a person is visible (you can see Ada), so there is nothing to hide —
  // the honest answer is "not a thing you may propose against", the same shape
  // the tier wall uses. What matters for the design rule is that it is REFUSED
  // and leaves nothing behind, not which of the two refusal codes it wears.
  assert.equal(res.status, 403, 'a person has no owner to consent and no fields to patch')
  assert.equal(
    store.listSocialProposals({ kind: 'principal', id: ADA_NAME }, GRACE).length,
    0,
    'and nothing inert was stored',
  )
})

test('refusal: a DM thread is not grantable — the pair wall has no third seat to sell', async () => {
  const thread = await dmTo(ADA_NAME, 'grant check', GRACE)
  const res = await call(
    'POST', '/grants',
    { subject: { kind: 'discussion', id: thread.json.id }, audience: { kind: 'org', orgId: 'tenant-growthworks' }, tier: 'view' },
    { 'x-tenant-id': GRACE },
  )
  assert.equal(res.status, 400, 'the ONE place the S2 recursion rule is cut, and it is cut at the door')
  // The cut has to hold in effect, not just in status code.
  const peek = await call('GET', `/discussions/${thread.json.id}`, undefined, { 'x-tenant-id': 'tenant-growthworks' })
  assert.equal(peek.status, 404)
})

/** ── A legacy DM must not outlive the name it was addressed to ───────────────
 *  Owner-reported 2026-08-11: a `social.messaged` bell opened "This discussion
 *  isn't visible from this account (or no longer exists)."
 *
 *  The row was written before S7 stamped `targetTenant`, so its only handle on
 *  the addressee was the anchor's display NAME — and the seed rename
 *  (Acme, Inc. → Ada Lovelace) left it naming somebody nobody is. From there
 *  `dmParties` resolves to the OPENER alone, which does not degrade so much as
 *  compound: the addressee 404s out of her own conversation, it vanishes from
 *  her inbox, and the bell announcing it becomes a dead door.
 *  `refreshStoredNames` cannot help — it re-derives the anchor FROM the id that
 *  is missing.
 *
 *  These lock the recovery and, just as importantly, its RESTRAINT: the same
 *  move applied to an S8 wall post would invent an addressee out of a replier
 *  and pair-wall a public utterance out of everyone else's sight. */
const legacyRow = (over: Record<string, unknown> = {}) =>
  ({
    id: `disc-legacy-${(n += 1)}`,
    anchor: { ref: { kind: 'principal', id: 'Acme, Inc.' } }, // a name nobody bears now
    state: 'open',
    openedBy: 'Grace Hopper',
    openedAt: 1,
    openerTenant: GRACE,
    // No `targetTenant` — the whole point: this row predates the field.
    posts: [
      { id: 'p1', seq: 1, author: 'Grace Hopper', authorTenant: GRACE, body: 'hi', at: 1, reactedBy: [] },
      { id: 'p2', seq: 2, author: 'Ada Lovelace', authorTenant: ADA, body: 'hello', at: 2, reactedBy: [] },
    ],
    ...over,
  }) as any

test('a legacy DM whose addressee was renamed is recovered from its own posts', () => {
  const row = legacyRow()
  assert.equal(row.targetTenant, undefined, 'precondition: nothing identifies the addressee but a dead name')
  recoverDmParties([row])
  assert.equal(row.targetTenant, ADA, 'the one other voice in the thread IS the addressee')
})

test('the recovery refuses anything it cannot prove is a DM', () => {
  // A WALL post (S8) anchored on its own author, replied to by someone else:
  // stamping the replier would turn a public post into a two-party DM. The
  // anchor name is stale here too, so the repair cannot tell it apart — which is
  // exactly why it must decline whenever more than the pair could be meant.
  const wallish = legacyRow({
    posts: [
      { id: 'p1', seq: 1, author: 'Grace', authorTenant: GRACE, body: 'a post', at: 1, reactedBy: [] },
      { id: 'p2', seq: 2, author: 'Ada', authorTenant: ADA, body: 'reply', at: 2, reactedBy: [] },
      { id: 'p3', seq: 3, author: 'Maya', authorTenant: 'tenant-growthworks', body: 'me too', at: 3, reactedBy: [] },
    ],
  })
  recoverDmParties([wallish])
  assert.equal(wallish.targetTenant, undefined, 'three voices are not a pair — no addressee is invented')

  // A row whose anchor name STILL resolves needs no repair, and must not be
  // second-guessed: the name is the addressee, exactly as written.
  const live = legacyRow({ anchor: { ref: { kind: 'principal', id: ADA_NAME } } })
  recoverDmParties([live])
  assert.equal(live.targetTenant, undefined, 'a resolvable name is left to the ordinary name path')

  // And a thread that is not principal-anchored is none of this function's business.
  const resource = legacyRow({ anchor: { ref: { kind: 'project', id: 'p-insights' } } })
  recoverDmParties([resource])
  assert.equal(resource.targetTenant, undefined, 'a resource thread is untouched')
})
test('a legacy DM bell recovers its actor, so one person is not named two ways', () => {
  // The other half of the same report: the inbox said "Beta Platform sent you a
  // message" while the thread it opened was headed "Grace Hopper".
  const thread = legacyRow({ targetTenant: ADA })
  const bell: any = { id: 'ntf-legacy-1', kind: 'social.messaged', at: 1, read: false, actor: 'Beta Platform', discussionId: thread.id, tenantId: ADA }
  recoverBellActors([bell], [thread])
  assert.equal(bell.actorTenant, GRACE, 'the actor is the party that is not the recipient')

  // A resource-thread bell is NOT repairable — any of its posters could have
  // rung it, and a guess would credit the act to the wrong person.
  const resourceBell: any = { id: 'ntf-legacy-2', kind: 'social.discussed', at: 1, read: false, actor: 'Beta Platform', discussionId: 'disc-seed-1', tenantId: ADA }
  const resourceThread = legacyRow({ id: 'disc-seed-1', anchor: { ref: { kind: 'project', id: 'p-insights' } } })
  recoverBellActors([resourceBell], [resourceThread])
  assert.equal(resourceBell.actorTenant, undefined, 'a thread with many possible actors gets no guess')

  // A row that already carries its id is left alone.
  const fresh: any = { id: 'ntf-3', kind: 'social.messaged', at: 1, read: false, actor: 'Grace Hopper', actorTenant: GRACE, discussionId: thread.id, tenantId: ADA }
  recoverBellActors([fresh], [thread])
  assert.equal(fresh.actorTenant, GRACE, 'an already-stamped bell is untouched')
})

test('legacy seed bell aliases recover their authority ids before names refresh', () => {
  const aliases = [
    ['Acme, Inc.', 'tenant-acme'],
    ['Beta Platform', 'tenant-beta'],
    ['Growthworks', 'tenant-growthworks'],
    ['Northlight Studio', 'tenant-northlight'],
    ['Harbor Support', 'tenant-harbor'],
    ['Rei’s Lab', 'tenant-reislab'],
  ]
  const rows: any[] = aliases.map(([actor], index) => ({
    id: `ntf-legacy-seed-${index}`,
    kind: 'social.followed',
    at: index,
    read: false,
    actor,
    tenantId: ADA,
  }))
  const unknown: any = { id: 'ntf-legacy-unknown', kind: 'social.followed', at: 9, read: false, actor: 'Unmapped Person', tenantId: ADA }
  rows.push(unknown)

  recoverSeedBellActors(rows)

  assert.deepEqual(rows.slice(0, aliases.length).map((row) => row.actorTenant), aliases.map(([, tenant]) => tenant))
  assert.equal(unknown.actorTenant, undefined, 'an arbitrary legacy name is never guessed')
})
