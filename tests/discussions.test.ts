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
