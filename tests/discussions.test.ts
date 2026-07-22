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
import { store } from '../server/store.ts'
import { call } from './helpers/http.ts'

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
    { kind: 'artifact-range', from: 1 },
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
    { kind: 'artifact-range', from: 1, to: 2 },
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
    { anchor: { ref, locus: { kind: 'artifact-range', from: 3, to: 8 } }, firstPost: 'These lines' },
    { 'x-tenant-id': OWNER },
  )
  const same = await call(
    'POST',
    '/discussions',
    { anchor: { ref, locus: { kind: 'artifact-range', from: 3, to: 8 } }, firstPost: 'Still these lines' },
    { 'x-tenant-id': OWNER },
  )
  assert.equal(same.json.id, a.json.id, 'an equal range is the same position')
  // A range that merely overlaps is a different position — the rule is
  // equality, deliberately: "near enough" would need a per-kind notion of
  // overlap in the kind-generic substrate, which S0 forbids.
  const overlapping = await call(
    'POST',
    '/discussions',
    { anchor: { ref, locus: { kind: 'artifact-range', from: 3, to: 9 } }, firstPost: 'A wider read' },
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
  const d = (await call('POST', '/discussions', { anchor: { ref, locus: { kind: 'artifact-range', from: 1, to: 4 } }, firstPost: 'Anchored' }, { 'x-tenant-id': AUDIENCE })).json
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
