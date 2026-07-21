/** Social S4 — the Commons feed (docs/design/social-layer.md §4). The feed is
 *  a PROJECTION over the primitives: a post = a grant carrying a NOTE (silent
 *  grants stay out — INV-9's access/publish distinction made visible) or a
 *  ledger landing; each item rides its subject's ROOT discussion (one
 *  conversation, two projections). Readability mirrors the subject's walls;
 *  order is chronological — no ranking. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from '../server/store.ts'
import { call } from './helpers/http.ts'

const OWNER = 'tenant-commons-owner'
const BYSTANDER = 'tenant-commons-bystander'
const AUDIENCE = 'tenant-beta'
let n = 0

test('the feed: published shares in, silent grants out, walls per viewer, comments ride the root thread', async () => {
  const projectId = `p-commons-${(n += 1)}`
  store.applyRelationOp({ kind: 'create-project', projectId, projectName: `Commons ${n}`, projectDescription: 'A test world.' }, OWNER)

  // A SILENT grant (no note) — access only, never a feed item.
  const silent = await call(
    'POST', '/grants',
    { subject: { kind: 'project', id: projectId }, audience: { kind: 'org', orgId: AUDIENCE }, tier: 'propose' },
    { 'x-tenant-id': OWNER },
  )
  assert.equal(silent.status, 200)
  const quiet = await call('GET', '/commons', undefined, { 'x-tenant-id': AUDIENCE })
  assert.ok(!quiet.json.some((i: any) => i.subject.id === projectId), 'a silent grant is access, not a post')

  // Re-grant WITH a note — the publish act; the card appears for the audience.
  await call(
    'POST', '/grants',
    { subject: { kind: 'project', id: projectId }, audience: { kind: 'org', orgId: AUDIENCE }, tier: 'propose', note: 'Tear it apart.' },
    { 'x-tenant-id': OWNER },
  )
  const feed = await call('GET', '/commons', undefined, { 'x-tenant-id': AUDIENCE })
  const post = feed.json.find((i: any) => i.subject.id === projectId)
  assert.ok(post, 'the published share is a feed item')
  assert.equal(post.kind, 'share')
  assert.equal(post.note, 'Tear it apart.')
  assert.equal(post.subjectName, `Commons ${n}`, 'the embed resolves the display face at serve time')
  assert.equal(post.commentCount, 0)

  // A bystander's feed never carries it (the subject wall).
  const other = await call('GET', '/commons', undefined, { 'x-tenant-id': BYSTANDER })
  assert.ok(!other.json.some((i: any) => i.subject.id === projectId), 'walls mirror the subject')

  // The card's comments ARE the root thread: post once, the count moves.
  await call('POST', '/discussions', { anchor: { ref: { kind: 'project', id: projectId } }, firstPost: 'First!' }, { 'x-tenant-id': AUDIENCE })
  const after = await call('GET', '/commons', undefined, { 'x-tenant-id': AUDIENCE })
  const post2 = after.json.find((i: any) => i.subject.id === projectId)
  assert.equal(post2.commentCount, 1)
  assert.ok(post2.discussionId, 'the card doors into the one root thread')

  // A landed proposal is a feed item too (the ledger's social visibility).
  const offered = await call(
    'POST', '/proposals',
    { subject: { kind: 'project', id: projectId }, delta: { kind: 'suggestion', text: 'Rename the readout' }, rationale: 'Clearer.' },
    { 'x-tenant-id': AUDIENCE },
  )
  await call('POST', `/proposals/${offered.json.id}/land`, undefined, { 'x-tenant-id': OWNER })
  const withLanding = await call('GET', '/commons', undefined, { 'x-tenant-id': AUDIENCE })
  const landing = withLanding.json.find((i: any) => i.id === `landing:${offered.json.id}`)
  assert.ok(landing, 'a landing rides the feed')
  assert.equal(landing.kind, 'landing')
  assert.equal(landing.landingNumber, 1)
})

test('the seeded publish rides the demo feed for its audience', async () => {
  const feed = await call('GET', '/commons', undefined, { 'x-tenant-id': 'tenant-beta' })
  assert.ok(
    feed.json.some((i: any) => i.subject.id === 'p-insights' && i.kind === 'share' && i.note),
    'the demo boots with Acme’s published share in Grace’s feed',
  )
})
