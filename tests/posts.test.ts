/** Social S8 — the square (docs/design/social-layer.md §5).
 *
 *  The design in one line: a POST is a Discussion anchored to the author's OWN
 *  principal. S7 refused a self-anchor; S8 gives that refusal a meaning, so the
 *  layer gains "say something" without a fourth primitive.
 *
 *      anchored to a RESOURCE  → a comment thread, walled by the resource
 *      anchored to ANOTHER     → a direct message, walled by the pair
 *      anchored to YOURSELF    → a post, walled by the square
 *
 *  What these rows lock is exactly the part that does NOT come for free: the
 *  third wall, the opposite identity rule (a DM is get-or-create, a post is
 *  always new), which list each belongs to, who gets rung, and the mention
 *  resolution that decides both the bells and the highlighting. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from '../server/store.ts'
import { call } from './helpers/http.ts'

const ADA = 'tenant-acme'
const GRACE = 'tenant-beta'
const STRANGER = 'tenant-post-stranger'
/** A real, mentionable name that is NOT a party to the DM below — the mention
 *  has to resolve for the assertion to mean anything (a name nobody wears would
 *  pass vacuously). */
const OUTSIDER_NAME = 'Growthworks'
const OUTSIDER = 'tenant-growthworks'
const ADA_NAME = 'Acme, Inc.'
const GRACE_NAME = 'Beta Platform'

const post = (body: string, tenantId: string) => call('POST', '/posts', { body }, { 'x-tenant-id': tenantId })
const feed = (tenantId: string) => call('GET', '/commons', undefined, { 'x-tenant-id': tenantId })

test('a post is a self-anchored discussion, and each utterance is its OWN thread', async () => {
  const a = await post('First thing I have to say', ADA)
  const b = await post('Second, unrelated thing', ADA)
  assert.equal(a.status, 200)
  assert.equal(b.status, 200)
  assert.notEqual(a.json.id, b.json.id, 'a post never gets-or-creates — that rule belongs to the DM')
  assert.equal(a.json.anchor.ref.kind, 'principal')
  assert.equal(a.json.anchor.ref.id, ADA_NAME, 'anchored to the author themselves')
  assert.equal(a.json.wall, true)
  assert.equal(a.json.direct, undefined, 'the wall face and the DM face are mutually exclusive')
  assert.equal(a.json.counterpart, undefined, 'a post is addressed to nobody, so it has no other party')
  assert.equal(a.json.posts.length, 1, 'the opening entry IS the post')
  assert.equal(a.json.posts[0].body, 'First thing I have to say')

  // An empty post is refused rather than stored as a silent nothing (INV-9).
  assert.equal((await post('   ', ADA)).status, 400)
})

test('the wall is the SQUARE: anyone signed in reads it, and anyone may reply', async () => {
  const p = await post('Anyone can see this one', ADA)
  const did = p.json.id

  // A stranger — no grant, no org seat, no follow — reads it.
  const read = await call('GET', `/discussions/${did}`, undefined, { 'x-tenant-id': STRANGER })
  assert.equal(read.status, 200, 'a post is public to the square by construction')
  assert.equal(read.json.canPost, true, 'and a square is a place you may speak in')

  const reply = await call('POST', `/discussions/${did}/posts`, { body: 'A stranger replies' }, { 'x-tenant-id': STRANGER })
  assert.equal(reply.status, 200)
  assert.equal(reply.json.posts.length, 2)

  // …which is exactly what a DM must NOT be. The contrast is the point: same
  // anchor KIND, opposite wall, decided by whose name it carries.
  const dm = await call(
    'POST', '/discussions',
    { anchor: { ref: { kind: 'principal', id: ADA_NAME } }, firstPost: 'private' },
    { 'x-tenant-id': GRACE },
  )
  assert.equal(dm.status, 200)
  assert.equal(
    (await call('GET', `/discussions/${dm.json.id}`, undefined, { 'x-tenant-id': STRANGER })).status,
    404,
    'a message between two people is walled to the pair, and hides its existence',
  )
})

/** The AUTHOR is the one reader for whom the two questions disagree, which is
 *  why the stranger case above passed while the app showed Ada no reply box on
 *  her own post (found in-app, 2026-08-08). `GET /social/capability` answers
 *  about a SUBJECT, and on a principal that means reachability — "could you
 *  cold-open to this person" — which is false for yourself by design (you do
 *  not DM yourself). A wall post's subject IS its author's principal, so a
 *  surface reading the subject-level answer refuses the author. The thread's
 *  own `canPost` is the answer that matches the write the server will accept. */
test('the author may reply on their OWN wall — the thread answers, not the subject', async () => {
  const p = await post('Something I want to add to later', ADA)
  const did = p.json.id

  const own = await call('GET', `/discussions/${did}`, undefined, { 'x-tenant-id': ADA })
  assert.equal(own.json.canPost, true, 'a square you may speak in includes your own corner of it')
  const reply = await call('POST', `/discussions/${did}/posts`, { body: 'Following up on myself' }, { 'x-tenant-id': ADA })
  assert.equal(reply.status, 200, 'and the write is accepted, so a UI that hid the box was hiding a legal act')
  assert.equal(reply.json.posts.length, 2)

  // The subject-level answer stays FALSE, deliberately: cold-opening a DM to
  // yourself is still nonsense. Both answers are correct about their own
  // question — which is precisely why a surface must ask the right one, and why
  // this asserts the disagreement rather than flattening it.
  const cap = await call('GET', `/social/capability?kind=principal&id=${encodeURIComponent(ADA_NAME)}`, undefined, {
    'x-tenant-id': ADA,
  })
  assert.equal(cap.status, 200)
  assert.equal(cap.json.canComment, false, 'you may not open a message to yourself — a different act, still refused')
})

/** A feed item's per-item ACTS (like, and any future one) resolve the item id
 *  back to a subject to find its wall. That parser must stay exhaustive over
 *  what the feed actually mints: it knew `share:` and `landing:` and never
 *  learned S8's `post:`, so liking a wall post 404'd and the button sat there
 *  reading "Couldn't update" under a card the feed was happily rendering.
 *  Derived from the live feed rather than a list of kinds — a hand-listed set
 *  is the thing that went stale. */
test('every item the feed mints can be acted on — the id parser is exhaustive', async () => {
  await post('A post that should be likeable', ADA)
  const items = (await feed(ADA)).json as { id: string; kind: string }[]
  const kinds = new Set(items.map((i) => i.kind))
  assert.ok(kinds.has('post') && kinds.size >= 2, `the feed mints more than one shape (saw ${[...kinds]})`)

  for (const item of items) {
    const liked = await call('POST', `/commons/${encodeURIComponent(item.id)}/like`, { liked: true }, { 'x-tenant-id': ADA })
    assert.equal(liked.status, 200, `a ${item.kind} item ('${item.id}') is visible in the feed but unlikeable`)
    assert.equal(liked.json.liked, true)
    assert.ok(liked.json.likes >= 1)
  }

  // …and the wall still holds: an id naming no live act is "no such item".
  assert.equal((await call('POST', '/commons/post:nope/like', { liked: true }, { 'x-tenant-id': ADA })).status, 404)
})

test('a post rings NOBODY; a reply rings the author', async () => {
  const before = store.listNotifications(ADA).length
  await post('An utterance that should ring no bells', ADA)
  assert.equal(store.listNotifications(ADA).length, before, 'your own post rings you (obviously) not at all')

  // Nor does it ring a follower: a followee's utterance reaches their LENS, not
  // their bell (D24 — access isn't involvement; the cut `social.followed` argues).
  store.setFollow(ADA_NAME, true, GRACE)
  const graceBefore = store.listNotifications(GRACE).length
  const p = await post('Another utterance, with a follower watching', ADA)
  assert.equal(store.listNotifications(GRACE).length, graceBefore, 'a feed that rang would be an engagement machine')

  // A REPLY is different — somebody is talking about what you said.
  await call('POST', `/discussions/${p.json.id}/posts`, { body: 'I disagree' }, { 'x-tenant-id': GRACE })
  const rung = store.listNotifications(ADA).filter((n) => n.kind === 'social.replied' && n.discussionId === p.json.id)
  assert.equal(rung.length, 1, 'a reply on your wall rings its own kind — not mail, and not a comment on a resource')
  // And it names no subject. A post's subject IS its author, so carrying one
  // would label Ada's own bell with Ada's name — the mistake `social.messaged`
  // was minted to avoid, one slice earlier.
  assert.equal(rung[0].subjectName, undefined, 'a bell never labels the reader with their own name')
})

test('@mentions ring the named — resolved server-side, and only where they can read', async () => {
  const before = store.listNotifications(GRACE).filter((n) => n.kind === 'social.mentioned').length
  const p = await post(`Handing this to @${GRACE_NAME} to look at`, ADA)
  assert.equal(p.status, 200)
  const rung = store.listNotifications(GRACE).filter((n) => n.kind === 'social.mentioned')
  assert.equal(rung.length, before + 1, 'being named is being addressed')
  assert.equal(rung[0].discussionId, p.json.id, 'and the bell doors onto the sentence that named them')

  // The SAME resolution rides the wire, so the UI highlights exactly the set
  // that was rung — never a second, drifting client-side parse.
  assert.deepEqual(p.json.posts[0].mentions, [GRACE_NAME])

  // A name nobody wears resolves to nothing at all.
  const none = await post('Talking about @Nobody At All here', ADA)
  assert.equal(none.json.posts[0].mentions, undefined)

  // A mention can never leak a thread the named party may not read: a DM
  // between Ada and Grace naming a stranger rings the stranger nothing.
  // Precondition: the name really resolves, so a silent bell is a WALL and not
  // a failed match (the vacuous-lock trap tests/CLAUDE.md warns about).
  const proof = await post(`hello @${OUTSIDER_NAME}`, ADA)
  assert.deepEqual(proof.json.posts[0].mentions, [OUTSIDER_NAME], 'the outsider name resolves in the open')
  const strangerBefore = store.listNotifications(OUTSIDER).filter((n) => n.kind === 'social.mentioned').length
  const dm = await call(
    'POST', '/discussions',
    { anchor: { ref: { kind: 'principal', id: ADA_NAME } }, firstPost: `psst @${OUTSIDER_NAME}` },
    { 'x-tenant-id': GRACE },
  )
  assert.equal(dm.status, 200)
  assert.equal(
    store.listNotifications(OUTSIDER).filter((n) => n.kind === 'social.mentioned').length,
    strangerBefore,
    'a mention must not become a way to announce a private thread',
  )
})

test('the feed carries posts, and each list keeps its own rows', async () => {
  const p = await post('Something for the square to carry', ADA)
  const rows = await feed(GRACE)
  assert.equal(rows.status, 200)
  const item = rows.json.find((i: { id: string }) => i.id === `post:${p.json.id}`)
  assert.ok(item, 'a post is a feed item')
  assert.equal(item.kind, 'post')
  assert.equal(item.note, 'Something for the square to carry', 'the words ARE the card')
  assert.equal(item.subject.kind, 'principal')
  assert.equal(item.subject.id, ADA_NAME, 'its subject is the author, so the card doors to their profile')
  assert.equal(item.discussionId, p.json.id, 'the post carries its OWN thread, not some other post of theirs')
  assert.equal(item.commentCount, 0, 'the opening entry is the card body, not one of its comments')

  await call('POST', `/discussions/${p.json.id}/posts`, { body: 'a reply' }, { 'x-tenant-id': GRACE })
  const after = (await feed(GRACE)).json.find((i: { id: string }) => i.id === `post:${p.json.id}`)
  assert.equal(after.commentCount, 1, 'and a reply is')

  // One list each — the rail rule. A post is not mail, and it is not a thread
  // about a resource, so it appears in neither of those two lists.
  assert.equal(
    store.listDirectMessages(ADA).some((d) => d.id === p.json.id),
    false,
    'the inbox means "talk with people"',
  )
  assert.equal(
    store.listMyDiscussions(ADA).some((d) => d.id === p.json.id),
    false,
    'the discussions hub means "talk about things"',
  )
  // …and it IS listed as that person's posts, which is what a profile shows.
  const mine = await call('GET', `/discussions?kind=principal&id=${encodeURIComponent(ADA_NAME)}`, undefined, { 'x-tenant-id': GRACE })
  assert.equal(mine.status, 200)
  assert.ok(mine.json.some((d: { id: string }) => d.id === p.json.id), 'a principal’s discussions are their posts')
  assert.equal(
    mine.json.some((d: { direct?: boolean }) => d.direct === true),
    false,
    'and never the DMs anchored to the same name',
  )
})

test('a post has no resolved state, and the author moderates their own wall', async () => {
  const p = await post('My wall, my rules', ADA)
  const did = p.json.id
  // Resolving is a verdict on a question. A post is not a question.
  const asAuthor = await call('GET', `/discussions/${did}`, undefined, { 'x-tenant-id': ADA })
  assert.equal(asAuthor.json.canResolve, undefined, 'nobody closes an utterance')
  assert.equal((await call('POST', `/discussions/${did}/resolve`, { state: 'resolved' }, { 'x-tenant-id': ADA })).status, 403)

  // The author holds the delete on replies under their own post — the S5
  // guardrail rule (moderation lives with the anchor's owner) reaching the
  // person who IS the anchor.
  const reply = await call('POST', `/discussions/${did}/posts`, { body: 'noise' }, { 'x-tenant-id': STRANGER })
  const noise = reply.json.posts[1]
  const seen = await call('GET', `/discussions/${did}`, undefined, { 'x-tenant-id': ADA })
  assert.equal(seen.json.posts[1].canDelete, true, 'the wall’s owner moderates it')
  assert.equal(
    (await call('DELETE', `/discussions/${did}/posts/${noise.id}`, undefined, { 'x-tenant-id': ADA })).status,
    200,
  )
})

test('a mute is still an earmuff: it hides a post from the muter, never from the square', async () => {
  const p = await post('Something Grace would rather not read', ADA)
  store.setMute(ADA_NAME, true, GRACE)
  const hidden = (await feed(GRACE)).json.some((i: { id: string }) => i.id === `post:${p.json.id}`)
  assert.equal(hidden, false, 'the muter stops hearing it')
  const stillThere = (await feed(STRANGER)).json.some((i: { id: string }) => i.id === `post:${p.json.id}`)
  assert.equal(stillThere, true, 'everyone else is unaffected — a mute moves no wall')
  // And it never unmakes the author: the post is still readable by id.
  assert.equal((await call('GET', `/discussions/${p.json.id}`, undefined, { 'x-tenant-id': GRACE })).status, 200)
  store.setMute(ADA_NAME, false, GRACE)
})

test('posting makes you EXIST: an utterance is a public face, so a mention’s door is not dead', async () => {
  // The mention door surfaced this. A post is the most direct public act the
  // layer has, so the D21 publisher-existence rule has to count it — otherwise
  // @-mentioning somebody who has only ever POSTED lands the reader on "shares
  // nothing publicly — or doesn't exist", about a person whose words they were
  // just reading. It works because a post IS a Commons item, which is the same
  // predicate S5 already used; this row is here so a future change to the feed
  // projection can't quietly take the profile away with it.
  const NEWCOMER = 'tenant-post-newcomer'
  const name = store.identity({ 'x-tenant-id': NEWCOMER }).tenant.name
  const profile = (viewer: string) => call('GET', `/directory/owners/${encodeURIComponent(name)}`, undefined, { 'x-tenant-id': viewer })
  assert.equal((await profile(ADA)).status, 404, 'a workspace that has said nothing is invisible — existence-hiding holds')
  await post('Hello, square. First thing I have said.', NEWCOMER)
  assert.equal((await profile(ADA)).status, 200, 'having spoken in the square IS a public identity')

  // …and their posts are what the profile's Commons band shows.
  const theirs = await call('GET', `/discussions?kind=principal&id=${encodeURIComponent(name)}`, undefined, { 'x-tenant-id': ADA })
  assert.equal(theirs.json.length, 1)
})

test('a wall is bounded: the post cap answers 409 rather than growing the store forever', async () => {
  // Not a lifetime limit on speaking — it sits far above any real use — but not
  // absent either: every post is a persisted row, and the contributions ledger
  // carries a total cap beside its open cap for exactly this reason. The rate
  // limit bounds how FAST; this bounds how MANY.
  const CAPPED = 'tenant-post-capped'
  const { MAX } = { MAX: 1000 }
  // Fill the wall through the real mutator (fast — no HTTP), then prove the
  // door refuses rather than silently accepting.
  for (let i = 0; i < MAX; i += 1) store.openWallPost(`filler ${i}`, CAPPED)
  const over = await post('one too many', CAPPED)
  assert.equal(over.status, 409, 'the cap is a refusal, not a silent no-op')
  // …and it is per AUTHOR: everyone else is unaffected.
  assert.equal((await post('unaffected', ADA)).status, 200)
})
