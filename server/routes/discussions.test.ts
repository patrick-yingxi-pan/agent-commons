/** Social S2 — the Discussion entity (docs/design/social-layer.md §2.3).
 *  Invariants under test: visibility INHERITS the anchor's read wall (never
 *  wider — the existence-hiding 404 on every face); the ROOT-thread rule
 *  (locus-free open is get-or-create: one public stream per subject); comment
 *  authority = owner / legacy-shared / comment-tier grant, while `view` reads
 *  silently and may still REACT (the thinnest signal); resolve is opener-or-
 *  anchor-owner; the wire face is redacted (display names + counts, never raw
 *  tenant ids); recursion (a discussion anchors to a discussion). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from '../store/index.ts'
import { call } from '../testkit/http.ts'
import { discussionPostId } from '../discussionPostIdentity.ts'

const OWNER = 'tenant-disc-owner'
const BYSTANDER = 'tenant-disc-bystander'
const AUDIENCE = 'tenant-beta' // seeded org — grant audiences must be registered
let n = 0

/** A private project owned by OWNER, granted to AUDIENCE at `tier`. */
async function arena(tier: 'view' | 'comment' = 'comment') {
  const projectId = `p-disc-${(n += 1)}`
  store.applyRelationOp({ kind: 'create-project', projectId, projectName: `Disc ${n}`, projectDescription: '' }, OWNER)
  const g = await call(
    'POST', '/grants',
    { subject: { kind: 'project', id: projectId }, audience: { kind: 'org', orgId: AUDIENCE }, tier },
    { 'x-tenant-id': OWNER },
  )
  assert.equal(g.status, 200)
  return { projectId, ref: { kind: 'project', id: projectId } }
}

test('root-thread rule: a locus-free open is get-or-create — one public stream per subject', async () => {
  const { ref } = await arena()
  const first = await call('POST', '/discussions', { anchor: { ref }, firstPost: 'First!' }, { 'x-tenant-id': OWNER })
  assert.equal(first.status, 200)
  const second = await call('POST', '/discussions', { anchor: { ref }, firstPost: 'Me too' }, { 'x-tenant-id': AUDIENCE })
  assert.equal(second.status, 200)
  assert.equal(second.json.id, first.json.id, 'the second locus-free open lands in the SAME root thread')
  assert.equal(second.json.posts.length, 2, 'as an appended post')
  const list = await call('GET', `/discussions?kind=${ref.kind}&id=${ref.id}`, undefined, { 'x-tenant-id': OWNER })
  assert.equal(list.json.length, 1, 'one root, not two')
})

test('keyed social prose persists one opaque post identity across response-cache loss', async () => {
  const { ref } = await arena()
  const openKey = `discussion-open-${ref.id}`
  const openInput = { anchor: { ref }, firstPost: 'One durable opening' }
  const headers = { 'x-tenant-id': OWNER, 'idempotency-key': openKey }
  const opened = await call('POST', '/discussions', openInput, headers)
  const openedReplay = await call('POST', '/discussions', openInput, headers)
  const openingId = discussionPostId(OWNER, openKey)
  assert.equal(opened.status, 200)
  assert.equal(openedReplay.headers['idempotency-replayed'], 'true')
  assert.equal(opened.json.posts[0].id, openingId)
  assert.equal(openedReplay.json.posts[0].id, openingId)
  const durableOpen = store.openDiscussion(openInput, OWNER, openingId)
  assert.equal(typeof durableOpen, 'object')
  assert.equal((durableOpen as any).posts.filter((post: any) => post.id === openingId).length, 1)

  const appendKey = `discussion-append-${ref.id}`
  const appendHeaders = { 'x-tenant-id': OWNER, 'idempotency-key': appendKey }
  const appended = await call('POST', `/discussions/${opened.json.id}/posts`, { body: 'One durable reply' }, appendHeaders)
  const appendedReplay = await call('POST', `/discussions/${opened.json.id}/posts`, { body: 'One durable reply' }, appendHeaders)
  const replyId = discussionPostId(OWNER, appendKey)
  assert.equal(appended.status, 200)
  assert.equal(appendedReplay.headers['idempotency-replayed'], 'true')
  assert.equal(appended.json.posts.at(-1).id, replyId)
  const durableAppend = store.postToDiscussion(opened.json.id, 'One durable reply', OWNER, undefined, replyId)
  assert.equal(typeof durableAppend, 'object')
  assert.equal((durableAppend as any).posts.filter((post: any) => post.id === replyId).length, 1)

  const wallKey = `wall-post-${ref.id}`
  const wallHeaders = { 'x-tenant-id': OWNER, 'idempotency-key': wallKey }
  const wall = await call('POST', '/posts', { body: 'One durable wall post' }, wallHeaders)
  const wallReplay = await call('POST', '/posts', { body: 'One durable wall post' }, wallHeaders)
  const wallPostId = discussionPostId(OWNER, wallKey)
  assert.equal(wall.status, 200)
  assert.equal(wallReplay.headers['idempotency-replayed'], 'true')
  assert.equal(wall.json.posts[0].id, wallPostId)
  const durableWall = store.openWallPost('One durable wall post', OWNER, wallPostId)
  assert.equal(typeof durableWall, 'object')
  assert.equal((durableWall as any).posts.filter((post: any) => post.id === wallPostId).length, 1)
})

test('SOCIAL-6b: the same rule per POSITION — one public stream per (subject, locus)', async () => {
  const { ref } = await arena()
  const at = (messageId: string) => ({ kind: 'session-turn' as const, messageId })
  const open = (locus: unknown, body: string, tenant = OWNER) =>
    call('POST', '/discussions', { anchor: { ref, locus }, firstPost: body }, { 'x-tenant-id': tenant })

  const first = await open(at('m1'), 'This step looks wrong')
  assert.equal(first.status, 200)
  // The whole point of the gutter affordance: clicking "discuss this turn"
  // again — by anyone — must land in the thread that's already there, not fork
  // a second one nobody can tell apart.
  const again = await open(at('m1'), 'Agreed', AUDIENCE)
  assert.equal(again.json.id, first.json.id, 'a second open on the SAME turn appends')
  assert.equal(again.json.posts.length, 2)

  // A DIFFERENT position is a different conversation.
  const elsewhere = await open(at('m2'), 'And this one')
  assert.notEqual(elsewhere.json.id, first.json.id, 'another turn is another thread')

  // …and a position is never confused with the whole entity, in either
  // direction: the root thread and a turn's thread are distinct streams.
  const root = await call('POST', '/discussions', { anchor: { ref }, firstPost: 'About the whole thing' }, { 'x-tenant-id': OWNER })
  assert.notEqual(root.json.id, first.json.id, 'the root is not a turn thread')
  const rootAgain = await call('POST', '/discussions', { anchor: { ref }, firstPost: 'more' }, { 'x-tenant-id': OWNER })
  assert.equal(rootAgain.json.id, root.json.id, 'and the root still get-or-creates')

  const list = await call('GET', `/discussions?kind=${ref.kind}&id=${ref.id}`, undefined, { 'x-tenant-id': OWNER })
  assert.equal(list.json.length, 3, 'root + two turns — no duplicates')
  // Root first, then the anchored ones (the listing band).
  assert.equal(list.json[0].anchor.locus, undefined, 'the root leads the list')
  assert.equal(list.json.filter((d: { anchor: { locus?: unknown } }) => d.anchor.locus).length, 2)
})

test('SOCIAL-6b: an undeclared locus is REFUSED, not stored (INV-9, strict core)', async () => {
  const { ref } = await arena()
  // An anchor is persisted and echoed to everyone who can read the subject, so
  // the shape is checked against the declared union — not stored as it arrived.
  const bad = [
    { kind: 'made-up', whatever: 1 },
    { kind: 'session-turn' }, // the variant's field is missing
    { kind: 'session-turn', messageId: 7 }, // …and it is typed
    { kind: 'session-turn', messageId: 'm1', extra: 'smuggled' }, // no extra fields ride along
    { kind: 'artifact-block' }, // the variant's field is missing
    { kind: 'artifact-block', block: '2' }, // …and it is typed: an index is a number
    { kind: 'artifact-block', block: 1, to: 8 }, // a line-span shape no longer rides along
    'not-an-object',
    null,
  ]
  for (const locus of bad) {
    const out = await call('POST', '/discussions', { anchor: { ref, locus }, firstPost: 'nope' }, { 'x-tenant-id': OWNER })
    assert.equal(out.status, 400, `refused: ${JSON.stringify(locus)}`)
  }
  const list = await call('GET', `/discussions?kind=${ref.kind}&id=${ref.id}`, undefined, { 'x-tenant-id': OWNER })
  assert.equal(list.json.length, 0, 'nothing was created by a refused open')
  // …and the declared variants still pass.
  for (const locus of [
    { kind: 'session-turn', messageId: 'm1' },
    { kind: 'artifact-block', block: 1 },
    { kind: 'schedule-run', runId: 'r1' },
    { kind: 'relation-edge', relationId: 'e1' },
  ]) {
    const out = await call('POST', '/discussions', { anchor: { ref, locus }, firstPost: 'ok' }, { 'x-tenant-id': OWNER })
    assert.equal(out.status, 200, `accepted: ${JSON.stringify(locus)}`)
  }
})

test('SOCIAL-6b: locus equality is by VALUE, not identity — a re-sent anchor matches', async () => {
  const { ref } = await arena()
  const a = await call(
    'POST',
    '/discussions',
    { anchor: { ref, locus: { kind: 'artifact-block', block: 3 } }, firstPost: 'This block' },
    { 'x-tenant-id': OWNER },
  )
  const same = await call(
    'POST',
    '/discussions',
    { anchor: { ref, locus: { kind: 'artifact-block', block: 3 } }, firstPost: 'Still this block' },
    { 'x-tenant-id': OWNER },
  )
  assert.equal(same.json.id, a.json.id, 'an equal range is the same position')
  // A range that merely overlaps is a different position — the rule is
  // equality, deliberately: "near enough" would need a per-kind notion of
  // overlap in the kind-generic substrate, which S0 forbids.
  const overlapping = await call(
    'POST',
    '/discussions',
    { anchor: { ref, locus: { kind: 'artifact-block', block: 9 } }, firstPost: 'Another block' },
    { 'x-tenant-id': OWNER },
  )
  assert.notEqual(overlapping.json.id, a.json.id, 'a different range is a different thread')
})

test('inheritance: the discussion wall IS the anchor wall — audience reads, bystander 404s on every face', async () => {
  const { ref } = await arena()
  const d = (await call('POST', '/discussions', { anchor: { ref }, firstPost: 'Hello' }, { 'x-tenant-id': OWNER })).json
  const asAudience = await call('GET', `/discussions/${d.id}`, undefined, { 'x-tenant-id': AUDIENCE })
  assert.equal(asAudience.status, 200)
  for (const [method, path, body] of [
    ['GET', `/discussions?kind=${ref.kind}&id=${ref.id}`, undefined],
    ['GET', `/discussions/${d.id}`, undefined],
    ['POST', `/discussions/${d.id}/posts`, { body: 'sneak' }],
    ['POST', `/discussions/${d.id}/posts/${d.posts[0].id}/react`, undefined],
    ['POST', `/discussions/${d.id}/resolve`, undefined],
  ] as const) {
    const res = await call(method, path, body, { 'x-tenant-id': BYSTANDER })
    assert.equal(res.status, 404, `${method} ${path} must 404 for a bystander (existence-hiding)`)
  }
})

test('comment authority: view reads silently (may react, not post); comment posts; redaction holds', async () => {
  const { ref } = await arena('view')
  const d = (await call('POST', '/discussions', { anchor: { ref }, firstPost: 'Owner opens' }, { 'x-tenant-id': OWNER })).json
  assert.equal(d.openerTenant, undefined, 'raw opener tenant never crosses')
  assert.equal(d.posts[0].authorTenant, undefined, 'raw author tenant never crosses')
  assert.equal(d.posts[0].reactedBy, undefined, 'the reacting tenants never cross — only the count')

  const read = await call('GET', `/discussions/${d.id}`, undefined, { 'x-tenant-id': AUDIENCE })
  assert.equal(read.status, 200, 'view tier reads')
  const post = await call('POST', `/discussions/${d.id}/posts`, { body: 'nope' }, { 'x-tenant-id': AUDIENCE })
  assert.equal(post.status, 403, 'view tier may not post')
  const open = await call('POST', '/discussions', { anchor: { ref, locus: { kind: 'session-turn', messageId: 'm1' } }, firstPost: 'nope' }, { 'x-tenant-id': AUDIENCE })
  assert.equal(open.status, 403, 'view tier may not open either')
  const react = await call('POST', `/discussions/${d.id}/posts/${d.posts[0].id}/react`, undefined, { 'x-tenant-id': AUDIENCE })
  assert.equal(react.status, 200, 'any reader may react')
  assert.equal(react.json.posts[0].reactions, 1)
  assert.equal(react.json.posts[0].reacted, true, 'viewer-relative bit')
  const unreact = await call('POST', `/discussions/${d.id}/posts/${d.posts[0].id}/react`, undefined, { 'x-tenant-id': AUDIENCE })
  assert.equal(unreact.json.posts[0].reactions, 0, 'react toggles')
})

test('resolve: opener or anchor owner; a commenting visitor may not; posting stays open after resolve (aftermath)', async () => {
  const { ref } = await arena('comment')
  const d = (await call('POST', '/discussions', { anchor: { ref, locus: { kind: 'artifact-block', block: 1 } }, firstPost: 'Anchored' }, { 'x-tenant-id': AUDIENCE })).json
  assert.equal(d.mine, true, 'the opener sees their own flag')
  const byAudienceOther = await call('POST', `/discussions/${d.id}/resolve`, undefined, { 'x-tenant-id': AUDIENCE })
  assert.equal(byAudienceOther.status, 200, 'the opener resolves')
  assert.equal(byAudienceOther.json.state, 'resolved')
  const aftermath = await call('POST', `/discussions/${d.id}/posts`, { body: 'Post-resolve note' }, { 'x-tenant-id': OWNER })
  assert.equal(aftermath.status, 200, 'a resolved thread keeps accruing (CW7)')
  const reopen = await call('POST', `/discussions/${d.id}/resolve`, { state: 'open' }, { 'x-tenant-id': OWNER })
  assert.equal(reopen.status, 200, 'the anchor owner may flip state too')
  assert.equal(reopen.json.state, 'open')
})

test('recursion: a discussion anchors to a discussion (the sixth noun is a full noun)', async () => {
  const { ref } = await arena('comment')
  const root = (await call('POST', '/discussions', { anchor: { ref }, firstPost: 'Root' }, { 'x-tenant-id': OWNER })).json
  const meta = await call(
    'POST', '/discussions',
    { anchor: { ref: { kind: 'discussion', id: root.id } }, firstPost: 'Talking about the talk' },
    { 'x-tenant-id': OWNER },
  )
  assert.equal(meta.status, 200)
  assert.equal(meta.json.anchor.ref.kind, 'discussion')
  // Its wall is the OPENER's namespace (the adapter's owner face): the
  // audience of the project does NOT automatically read the meta-discussion.
  const asBystander = await call('GET', `/discussions/${meta.json.id}`, undefined, { 'x-tenant-id': BYSTANDER })
  assert.equal(asBystander.status, 404)
})

test('a post RINGS the anchor owner and the thread’s other participants — never the author', async () => {
  // Without this the share → discuss loop is one-way: a comment is the one
  // social act whose subject nobody would otherwise be told about.
  const { ref } = await arena('comment')
  // Scoped to THIS thread: tenants are reused across the tests in this file, so
  // a bare count would fold in every earlier walk's bells.
  let did = ''
  const bells = async (tenant: string) =>
    ((await call('GET', '/notifications', undefined, { 'x-tenant-id': tenant })).json as { kind: string; discussionId?: string }[])
      .filter((n) => n.kind === 'social.discussed' && n.discussionId === did)

  // The AUDIENCE opens a thread on the owner's subject → the owner is rung.
  const d = (await call('POST', '/discussions', { anchor: { ref }, firstPost: 'Question' }, { 'x-tenant-id': AUDIENCE })).json
  did = d.id
  const ownerBells = await bells(OWNER)
  assert.equal(ownerBells.length, 1, 'the FIRST post rings too — that is when someone starts talking about your thing')
  assert.equal(ownerBells[0].discussionId, d.id, 'the bell points at the THREAD (its own page)')
  assert.equal((await bells(AUDIENCE)).length, 0, 'never the author')

  // The OWNER replies → the audience (a participant) is rung, and the owner
  // isn't rung by their own post.
  await call('POST', `/discussions/${d.id}/posts`, { body: 'Answer' }, { 'x-tenant-id': OWNER })
  assert.equal((await bells(AUDIENCE)).length, 1, 'someone replied where you are talking')
  assert.equal((await bells(OWNER)).length, 1, 'still just the one — an author never rings themselves')

  // A BYSTANDER is never rung: a bell means you are involved, not merely that
  // the thing exists (and they can't read the anchor anyway).
  assert.equal((await bells(BYSTANDER)).length, 0, 'no broadcast')
})

test('un-sharing silences a stale participant — a revoked reader stops being rung (review finding)', async () => {
  // Past participation is not standing: the row carries the subject's display
  // name and doors into the thread, so ringing someone who lost access would
  // both leak that the thing is still being discussed and dead-end in a 404.
  const { projectId, ref } = await arena('comment')
  const d = (await call('POST', '/discussions', { anchor: { ref }, firstPost: 'While I could' }, { 'x-tenant-id': AUDIENCE })).json
  const mine = async () =>
    ((await call('GET', '/notifications', undefined, { 'x-tenant-id': AUDIENCE })).json as { kind: string; discussionId?: string }[])
      .filter((n) => n.kind === 'social.discussed' && n.discussionId === d.id)

  await call('POST', `/discussions/${d.id}/posts`, { body: 'Replying' }, { 'x-tenant-id': OWNER })
  assert.equal((await mine()).length, 1, 'a participant is rung while they can still read')

  // Revoke the grant that opened the anchor.
  const roster = (await call('GET', `/grants?kind=project&id=${projectId}`, undefined, { 'x-tenant-id': OWNER })).json
  for (const g of roster) await call('DELETE', `/grants/${g.id}`, undefined, { 'x-tenant-id': OWNER })
  assert.equal(
    (await call('GET', `/discussions/${d.id}`, undefined, { 'x-tenant-id': AUDIENCE })).status,
    404,
    'the thread is gone for them',
  )

  await call('POST', `/discussions/${d.id}/posts`, { body: 'Talking on' }, { 'x-tenant-id': OWNER })
  assert.equal((await mine()).length, 1, '…and no new bell arrives for a thread they can no longer read')
})

test('canResolve is the WRITE path’s own answer — the opener AND the anchor owner, nobody else', async () => {
  // Standing is two parties, so a surface gating on `mine` alone silently denied
  // the anchor owner a control they hold (the thread page did exactly that).
  // The wire face reports the same predicate the write path enforces.
  const { ref } = await arena('comment')
  const opened = await call('POST', '/discussions', { anchor: { ref }, firstPost: 'Mine' }, { 'x-tenant-id': AUDIENCE })
  const did = opened.json.id

  const face = async (tenant: string) => (await call('GET', `/discussions/${did}`, undefined, { 'x-tenant-id': tenant })).json

  const asOpener = await face(AUDIENCE)
  assert.equal(asOpener.mine, true)
  assert.equal(asOpener.canResolve, true, 'the opener has standing')

  const asOwner = await face(OWNER)
  assert.notEqual(asOwner.mine, true, 'the anchor owner did NOT open it')
  assert.equal(asOwner.canResolve, true, '…and still has standing — the case `mine` could not express')

  // Both faces match the write path exactly.
  assert.equal((await call('POST', `/discussions/${did}/resolve`, undefined, { 'x-tenant-id': OWNER })).status, 200)
  assert.equal(
    (await call('POST', `/discussions/${did}/resolve`, { state: 'open' }, { 'x-tenant-id': AUDIENCE })).status,
    200,
  )

  // A bystander can't even see it, let alone resolve it.
  assert.equal((await call('GET', `/discussions/${did}`, undefined, { 'x-tenant-id': BYSTANDER })).status, 404)
  assert.equal((await call('POST', `/discussions/${did}/resolve`, undefined, { 'x-tenant-id': BYSTANDER })).status, 404)
})

test('the seed scene has TALK: the shared project carries a cross-org root thread', async () => {
  // §7's demo scene shared Ada's flagship Project with Grace's org and left it
  // silent — the Discussions section, the entity panel's thread, and every
  // discussion-detail surface rendered only empty states on a cold start. The
  // `/ui-review` sweep found the hole the moment an unreachable cell became a
  // COVERAGE violation instead of a skip (2026-07-23): there was no discussion
  // to address. The scene now lands with the conversation the share produced.
  const asOwner = await call('GET', '/discussions?kind=project&id=p-insights', undefined, { 'x-tenant-id': 'tenant-acme' })
  assert.equal(asOwner.status, 200)
  const seeded = asOwner.json.find((d: any) => d.id === 'disc-seed-1')
  assert.ok(seeded, 'the seeded root thread rides the flagship project')
  assert.equal(seeded.anchor.locus, undefined, 'locus-free — it is the subject’s ROOT thread')
  assert.equal(seeded.state, 'open')
  assert.equal(seeded.posts.length, 2, 'the audience asks, the owner answers')
  assert.equal(seeded.posts[0].author, 'Grace Hopper')
  assert.equal(seeded.posts[1].author, 'Ada Lovelace')
  assert.equal(seeded.posts[1].mine, true, 'the owner’s reply reads as theirs')
  assert.equal(seeded.posts[0].reactions, 1, 'and the seeded reaction shows the thin signal in use')

  // Visibility INHERITS the anchor's wall, exactly like a runtime thread: the
  // seeded grant lets Grace's org read it; a bystander gets the existence-hiding 404.
  const asAudience = await call('GET', '/discussions/disc-seed-1', undefined, { 'x-tenant-id': 'tenant-beta' })
  assert.equal(asAudience.status, 200, 'the seeded grant carries the thread with it')
  assert.equal(asAudience.json.mine, true, 'Grace’s org opened it')
  assert.equal(
    (await call('GET', '/discussions/disc-seed-1', undefined, { 'x-tenant-id': BYSTANDER })).status,
    404,
    'a bystander cannot see the thread, because they cannot see what it discusses',
  )
})

test('the seeded thread rides the participating-threads hub read — the Discussions section is not empty', async () => {
  // `GET /discussions?mine=1` is what the Discussions rail section shows, and
  // what a discussion-detail cell is addressed from. Ada participates by having
  // replied, so the section has a row on a cold-start world.
  const mine = await call('GET', '/discussions?mine=1', undefined, { 'x-tenant-id': 'tenant-acme' })
  assert.equal(mine.status, 200)
  assert.ok(mine.json.some((d: any) => d.id === 'disc-seed-1'), 'the flagship account participates in the seed thread')
  const grace = await call('GET', '/discussions?mine=1', undefined, { 'x-tenant-id': 'tenant-beta' })
  assert.ok(grace.json.some((d: any) => d.id === 'disc-seed-1'), 'so does the audience that opened it')
  const bystander = await call('GET', '/discussions?mine=1', undefined, { 'x-tenant-id': BYSTANDER })
  assert.ok(!bystander.json.some((d: any) => d.id === 'disc-seed-1'), 'and nobody else')
})

test('seed thread ids never collide with runtime mints, and the seeds are code-owned', async () => {
  // The `grant-seed-*` rule, applied to talk: a runtime open mints `disc-N`, so
  // a `disc-seed-*` row can never be overwritten by one — and a snapshot written
  // by a pre-seed build regains the scene on load rather than leaving it mute.
  const { ref } = await arena('comment')
  const minted = await call('POST', '/discussions', { anchor: { ref }, firstPost: 'Runtime' }, { 'x-tenant-id': OWNER })
  assert.equal(minted.status, 200)
  assert.match(minted.json.id, /^disc-\d+$/, 'runtime threads mint from the counter')
  assert.notEqual(minted.json.id, 'disc-seed-1')

  const { readFileSync } = await import('node:fs')
  const src = readFileSync(new URL('../store/index.ts', import.meta.url), 'utf8')
  assert.ok(src.includes('const SEED_DISCUSSIONS'), 'the seed scene’s talk is a declared constant')
  assert.ok(
    src.includes('for (const seed of SEED_DISCUSSIONS)'),
    'rehydrate reconciles the seed threads back in — the code owns them, like SEED_GRANTS',
  )
  assert.ok(
    src.includes("d.id.startsWith('disc-seed-')"),
    'and seed rows stay out of the id counter, so restored mints cannot collide',
  )
})

// ══════════════════════════════════════════════════════════════════════════
//  S9 — REPLIES: answering one post rather than the thread
//
//  These used to lock a ONE-LEVEL cap on the write path: replying to a reply
//  re-parented onto the root, so a client could not build through the API a
//  tree no surface could render. The cap was inverted with the constraint that
//  earned it (owner directive 2026-08-11) — the surface learned to render a
//  chain, and the cap was left asserting something false about authorship: a
//  post answering Ada was STORED as answering Grace, which then rendered under
//  the wrong remark and rang the wrong person's bell.
//
//  So what is locked now is the opposite, and the rest is unchanged: the parent
//  is whoever was named, at any depth; an unknown parent is still refused; the
//  bell still follows the parent, which is exactly why the parent has to be
//  right. Depth is bounded on the SCREEN instead — `src/lib/reply-tree.test.ts`
//  holds the clamp and the fold that replaced this rule.
// ══════════════════════════════════════════════════════════════════════════

test('S9: a reply attaches to the post it answers', async () => {
  const { ref } = await arena()
  const opened = await call('POST', '/discussions', { anchor: { ref }, firstPost: 'the question' }, { 'x-tenant-id': OWNER })
  const did = opened.json.id
  const parent = opened.json.posts[0].id

  const replied = await call('POST', `/discussions/${did}/posts`, { body: 'the answer', replyTo: parent }, { 'x-tenant-id': AUDIENCE })
  assert.equal(replied.status, 200)
  assert.equal(replied.json.posts.at(-1).replyTo, parent, 'the reply names its parent')
  // A top-level post still carries nothing (INV-9: absent = top level), so a
  // thread written before this field reads correctly as all-root.
  const flat = await call('POST', `/discussions/${did}/posts`, { body: 'a separate remark' }, { 'x-tenant-id': AUDIENCE })
  assert.equal(flat.json.posts.at(-1).replyTo, undefined, 'absent means top level')
})

test('S9: replying to a REPLY nests deeper — the chain records who answered whom', async () => {
  const { ref } = await arena()
  const opened = await call('POST', '/discussions', { anchor: { ref }, firstPost: 'root' }, { 'x-tenant-id': OWNER })
  const did = opened.json.id
  const root = opened.json.posts[0].id
  const first = (await call('POST', `/discussions/${did}/posts`, { body: 'reply', replyTo: root }, { 'x-tenant-id': AUDIENCE })).json.posts.at(-1)
  assert.equal(first.replyTo, root)

  // THE inversion. This used to assert `second.replyTo === root` — the depth cap
  // re-parenting a grandchild onto the root. That answer was wrong about a fact
  // nobody asked the server to guess: the second post answered AUDIENCE, and the
  // store recorded it as answering OWNER.
  const second = (await call('POST', `/discussions/${did}/posts`, { body: 'reply to the reply', replyTo: first.id }, { 'x-tenant-id': OWNER })).json.posts.at(-1)
  assert.equal(second.replyTo, first.id, 'the grandchild names the reply it actually answered')

  // …and it keeps going. A chain is not a special case of two levels.
  const third = (await call('POST', `/discussions/${did}/posts`, { body: 'and again', replyTo: second.id }, { 'x-tenant-id': AUDIENCE })).json.posts.at(-1)
  assert.equal(third.replyTo, second.id)

  // Every parent resolves inside the thread, and following them terminates —
  // the property the removed cap used to give for free, and the one a recursive
  // renderer actually depends on.
  const all = (await call('GET', `/discussions/${did}`, undefined, { 'x-tenant-id': OWNER })).json.posts
  const byId = new Map(all.map((p) => [p.id, p]))
  for (const p of all) {
    const seen = new Set([p.id])
    for (let at = p; at.replyTo !== undefined; ) {
      const up = byId.get(at.replyTo)
      assert.ok(up, `${at.id} names a parent outside the thread`)
      assert.ok(!seen.has(up.id), `${p.id} sits in a cycle`)
      seen.add(up.id)
      at = up
    }
  }
  assert.equal(byId.get(third.id).replyTo, second.id, 'depth three survives the round trip through the wire face')
})

test('S9: a replyTo naming no post in THIS thread is refused, not silently detached', async () => {
  const { ref } = await arena()
  const a = await call('POST', '/discussions', { anchor: { ref }, firstPost: 'thread A' }, { 'x-tenant-id': OWNER })
  const b = await call('POST', '/discussions', { anchor: { ref, locus: { kind: 'artifact-block', block: 4 } }, firstPost: 'thread B' }, { 'x-tenant-id': OWNER })
  const foreign = b.json.posts[0].id

  for (const bad of ['dpost-does-not-exist', foreign]) {
    const res = await call('POST', `/discussions/${a.json.id}/posts`, { body: 'nope', replyTo: bad }, { 'x-tenant-id': OWNER })
    assert.equal(res.status, 400, `refused: ${bad}`)
  }
  // And nothing landed — a refused write leaves no detached post behind.
  const after = (await call('GET', `/discussions/${a.json.id}`, undefined, { 'x-tenant-id': OWNER })).json
  assert.equal(after.posts.length, 1, 'the thread is untouched by the refusals')
})

test('S9: a reply rings the person it answers, INSTEAD of the generic post bell', async () => {
  const { ref } = await arena()
  const opened = await call('POST', '/discussions', { anchor: { ref }, firstPost: 'my question' }, { 'x-tenant-id': OWNER })
  const did = opened.json.id
  const parent = opened.json.posts[0].id
  const inbox = async () => (await call('GET', '/notifications', undefined, { 'x-tenant-id': OWNER })).json
  const before = new Set((await inbox()).map((r) => r.id))

  await call('POST', `/discussions/${did}/posts`, { body: 'answering you', replyTo: parent }, { 'x-tenant-id': AUDIENCE })
  const fresh = (await inbox()).filter((r) => !before.has(r.id) && r.discussionId === did)
  assert.ok(fresh.length > 0, 'the act rang something')
  assert.ok(fresh.some((r) => r.kind === 'social.replied'), 'the answered author hears that they were answered')
  assert.ok(
    !fresh.some((r) => r.kind === 'social.discussed'),
    'and NOT also the generic row for the same act — the more-specific bell wins, as it does for mentions',
  )
})

test('S9: deep in a chain, the bell rings the person answered — not the root author', async () => {
  // The bell was always derived from the resolved parent, so this row locks no
  // new code. It locks the CONSEQUENCE of the depth cap's removal, which is the
  // reason the cap had to go: while a grandchild re-parented onto the root, this
  // arrived at the root author's inbox saying they had been answered by someone
  // who had answered somebody else entirely. A misdirected bell is the version
  // of a misattribution the reader cannot even see to correct.
  // THREE parties, because two cannot show this: the actor is dropped from their
  // own fan-out, so with only OWNER and AUDIENCE the "wrong" recipient is always
  // either the right one or the person who just posted — and the negative below
  // would hold no matter what the server did.
  const THIRD = 'tenant-acme'
  const { ref, projectId } = await arena()
  const g = await call(
    'POST', '/grants',
    { subject: { kind: 'project', id: projectId }, audience: { kind: 'org', orgId: THIRD }, tier: 'comment' },
    { 'x-tenant-id': OWNER },
  )
  assert.equal(g.status, 200, 'the third party can speak here')

  const opened = await call('POST', '/discussions', { anchor: { ref }, firstPost: 'the question' }, { 'x-tenant-id': OWNER })
  const did = opened.json.id
  const root = opened.json.posts[0].id
  // AUDIENCE answers OWNER's root…
  const mid = (await call('POST', `/discussions/${did}/posts`, { body: 'my answer', replyTo: root }, { 'x-tenant-id': AUDIENCE })).json.posts.at(-1)

  const inbox = async (who) => (await call('GET', '/notifications', undefined, { 'x-tenant-id': who })).json
  const ownerBefore = new Set((await inbox(OWNER)).map((r) => r.id))
  const audienceBefore = new Set((await inbox(AUDIENCE)).map((r) => r.id))

  // …and THIRD answers THAT. The person answered is AUDIENCE, two levels down.
  await call('POST', `/discussions/${did}/posts`, { body: 'answering your answer', replyTo: mid.id }, { 'x-tenant-id': THIRD })

  const heard = (rows, before) => rows.filter((r) => !before.has(r.id) && r.discussionId === did)
  const ownerHeard = heard(await inbox(OWNER), ownerBefore)
  assert.ok(
    heard(await inbox(AUDIENCE), audienceBefore).some((r) => r.kind === 'social.replied'),
    'the author of the post that was answered is the one told they were answered',
  )
  assert.ok(
    !ownerHeard.some((r) => r.kind === 'social.replied'),
    'the ROOT author is NOT told they were answered — nobody answered them',
  )
  // …and the negative above is not silence: OWNER is in this conversation and
  // still hears the ordinary row, which is what makes the missing reply bell a
  // statement rather than an absence of fan-out.
  assert.ok(ownerHeard.some((r) => r.kind === 'social.discussed'), 'the root author hears the generic row instead')
})

test('S9: retracting a parent PROMOTES its replies rather than stranding them', async () => {
  const { ref } = await arena()
  const opened = await call('POST', '/discussions', { anchor: { ref }, firstPost: 'to be retracted' }, { 'x-tenant-id': OWNER })
  const did = opened.json.id
  const parent = opened.json.posts[0].id
  const reply = (await call('POST', `/discussions/${did}/posts`, { body: 'someone else’s words', replyTo: parent }, { 'x-tenant-id': AUDIENCE })).json.posts.at(-1)

  // The parent's author retracts their own post. The reply is somebody ELSE's
  // words — retracting a parent may not delete them, and leaving them pointing
  // at nothing would drop them from any surface that grouped strictly.
  const del = await call('DELETE', `/discussions/${did}/posts/${parent}`, undefined, { 'x-tenant-id': OWNER })
  assert.equal(del.status, 200)
  const after = (await call('GET', `/discussions/${did}`, undefined, { 'x-tenant-id': OWNER })).json
  assert.equal(after.posts.length, 1, 'the reply survives its parent')
  assert.equal(after.posts[0].id, reply.id)
  assert.equal(after.posts[0].replyTo, undefined, 'promoted to top level, never left pointing at a hole')
})

test('S9: a CASCADE takes the branch — but only where the caller may delete every post in it', async () => {
  // The counterpart to the promotion rule above, and the reason it needs a
  // guard of its own (owner directive 2026-08-11). Promotion exists because
  // "the author of a parent does not get to retract somebody else's words"; a
  // cascade that skipped the check would hand exactly that power back through a
  // checkbox, and it would look like a convenience while doing it.
  //
  // A fresh arena per scenario, deliberately: a locus-free open is
  // GET-OR-CREATE (the root-thread rule at the top of this file), so reusing a
  // subject silently appends to the same thread — the first version of this
  // test did exactly that and counted posts from three scenarios at once.
  const mixed = async () => {
    const { ref } = await arena()
    const opened = await call('POST', '/discussions', { anchor: { ref }, firstPost: 'the head' }, { 'x-tenant-id': OWNER })
    const did = opened.json.id
    const parent = opened.json.posts[0].id
    const theirs = (await call('POST', `/discussions/${did}/posts`, { body: 'someone else’s words', replyTo: parent }, { 'x-tenant-id': AUDIENCE })).json.posts.at(-1)
    const deep = (await call('POST', `/discussions/${did}/posts`, { body: 'and my answer to them', replyTo: theirs.id }, { 'x-tenant-id': OWNER })).json.posts.at(-1)
    return { did, parent, theirs, deep }
  }

  // The AUDIENCE authored `theirs` but not `deep`, and does not own the anchor.
  // Cascading from their own post would take the owner's reply with it, so the
  // whole act is refused — not partially applied.
  {
    const { did, theirs } = await mixed()
    const refused = await call('DELETE', `/discussions/${did}/posts/${theirs.id}?cascade=1`, undefined, { 'x-tenant-id': AUDIENCE })
    assert.equal(refused.status, 403, 'a cascade needs the delete over every post underneath, not just the one clicked')
    const intact = (await call('GET', `/discussions/${did}`, undefined, { 'x-tenant-id': OWNER })).json
    assert.equal(intact.posts.length, 3, 'and nothing went — all-or-nothing, never a partial cascade reported as success')
    // Their own post alone is still theirs to retract, unchanged by any of this.
    assert.equal((await call('DELETE', `/discussions/${did}/posts/${theirs.id}`, undefined, { 'x-tenant-id': AUDIENCE })).status, 200)
    const narrow = (await call('GET', `/discussions/${did}`, undefined, { 'x-tenant-id': OWNER })).json
    assert.equal(narrow.posts.length, 2, 'the narrow delete is unaffected')
    assert.equal(narrow.posts.find((p) => p.id === deepId(narrow, 'and my answer'))?.replyTo, undefined, '`deep` promoted, as the rule above says')
  }

  // The ANCHOR OWNER holds the delete over their whole surface, so a cascade
  // from the head takes everything — the AUDIENCE's post included. That is the
  // moderation power S5 already grants them, not a new one.
  {
    const { did, parent } = await mixed()
    const swept = await call('DELETE', `/discussions/${did}/posts/${parent}?cascade=1`, undefined, { 'x-tenant-id': OWNER })
    assert.equal(swept.status, 200)
    assert.equal(swept.json.discussion, null, 'the last post going dissolves the thread')
    assert.equal((await call('GET', `/discussions/${did}`, undefined, { 'x-tenant-id': OWNER })).status, 404)
  }
})

/** The post whose body starts with `prefix` — ids are opaque, bodies are not. */
function deepId(thread: { posts: { id: string; body: string }[] }, prefix: string): string | undefined {
  return thread.posts.find((p) => p.body.startsWith(prefix))?.id
}

test('S9: absent `cascade` is the NARROW delete — INV-9, the minimal-risk reading', async () => {
  // The most destructive act in the layer must not be what an unadorned request
  // means. A client that forgets the flag, or a stale caller written before it
  // existed, gets the delete it already knew about.
  for (const [name, query] of [['no flag', ''], ['cascade=0', '?cascade=0'], ['cascade=false', '?cascade=false']] as const) {
    const { ref } = await arena()
    const fresh = await call('POST', '/discussions', { anchor: { ref }, firstPost: `head ${name}` }, { 'x-tenant-id': OWNER })
    const id = fresh.json.id
    const head = fresh.json.posts[0].id
    await call('POST', `/discussions/${id}/posts`, { body: `under ${name}`, replyTo: head }, { 'x-tenant-id': OWNER })
    assert.equal((await call('DELETE', `/discussions/${id}/posts/${head}${query}`, undefined, { 'x-tenant-id': OWNER })).status, 200)
    const after = (await call('GET', `/discussions/${id}`, undefined, { 'x-tenant-id': OWNER })).json
    assert.equal(after.posts.length, 1, `${name}: the reply survives — only an explicit cascade=1 takes the branch`)
  }
})
