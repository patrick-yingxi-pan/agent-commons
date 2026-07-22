/** S5 guardrails (docs/design/social-layer.md §2.5): owner moderation, report,
 *  and mutes. Invariants: a post is deletable by its AUTHOR or the ANCHOR
 *  OWNER, nobody else (existence-hiding for non-parties); deleting the last
 *  post removes the thread; a report rings the anchor owner (who holds the
 *  delete); a mute is a per-viewer EARMUFF — it filters the viewer's own feed
 *  and bell, and never touches the muted party's access. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from '../server/store.ts'
import { call } from './helpers/http.ts'

const OWNER = 'tenant-guard-owner'
const BYSTANDER = 'tenant-guard-bystander'
const AUDIENCE = 'tenant-beta'
let n = 0

async function arena() {
  const projectId = `p-guard-${(n += 1)}`
  store.applyRelationOp({ kind: 'create-project', projectId, projectName: `Guard ${n}`, projectDescription: '' }, OWNER)
  await call(
    'POST', '/grants',
    { subject: { kind: 'project', id: projectId }, audience: { kind: 'org', orgId: AUDIENCE }, tier: 'comment' },
    { 'x-tenant-id': OWNER },
  )
  const d = (
    await call('POST', '/discussions', { anchor: { ref: { kind: 'project', id: projectId } }, firstPost: 'Audience opens' }, { 'x-tenant-id': AUDIENCE })
  ).json
  return { projectId, d }
}

test('moderation: author-retract and owner-delete work; a bystander 404s; the last delete removes the thread', async () => {
  const { d } = await arena()
  const withReply = (await call('POST', `/discussions/${d.id}/posts`, { body: 'Owner replies' }, { 'x-tenant-id': OWNER })).json
  assert.equal(withReply.posts.length, 2)

  const stranger = await call('DELETE', `/discussions/${d.id}/posts/${withReply.posts[0].id}`, undefined, { 'x-tenant-id': BYSTANDER })
  assert.equal(stranger.status, 404, 'a non-party cannot even see the post')

  // The OWNER moderates the audience's post off their surface.
  const moderated = await call('DELETE', `/discussions/${d.id}/posts/${withReply.posts[0].id}`, undefined, { 'x-tenant-id': OWNER })
  assert.equal(moderated.status, 200)
  assert.equal(moderated.json.discussion.posts.length, 1, 'the audience post is gone')

  // The AUTHOR retracts their own last words — the empty thread dissolves.
  const retracted = await call('DELETE', `/discussions/${d.id}/posts/${withReply.posts[1].id}`, undefined, { 'x-tenant-id': OWNER })
  assert.equal(retracted.status, 200)
  assert.equal(retracted.json.discussion, null, 'deleting the last post removes the thread')
  const gone = await call('GET', `/discussions/${d.id}`, undefined, { 'x-tenant-id': OWNER })
  assert.equal(gone.status, 404)
})

test('report rings the anchor owner — the moderator who holds the delete', async () => {
  const { projectId, d } = await arena()
  const res = await call('POST', `/discussions/${d.id}/posts/${d.posts[0].id}/report`, undefined, { 'x-tenant-id': AUDIENCE })
  assert.equal(res.status, 200)
  assert.ok(
    store.listNotifications(OWNER).some((x) => x.kind === 'social.reported' && x.subjectId === projectId),
    'the owner’s bell carries the report',
  )
})

test('mute is an earmuff: the viewer’s feed and bell drop the actor; the muted party’s access is untouched', async () => {
  const { projectId } = await arena()
  // OWNER publishes — the audience sees the card and the bell.
  await call(
    'POST', '/grants',
    { subject: { kind: 'project', id: projectId }, audience: { kind: 'org', orgId: AUDIENCE }, tier: 'comment', note: 'Published.' },
    { 'x-tenant-id': OWNER },
  )
  const ownerName = OWNER // unregistered test tenants display as their raw id
  const before = await call('GET', '/commons', undefined, { 'x-tenant-id': AUDIENCE })
  assert.ok(before.json.some((i: any) => i.subject.id === projectId), 'pre-mute: the card shows')

  const muted = await call('PATCH', '/me/mutes', { name: ownerName, muted: true }, { 'x-tenant-id': AUDIENCE })
  assert.deepEqual(muted.json, [ownerName])
  const after = await call('GET', '/commons', undefined, { 'x-tenant-id': AUDIENCE })
  assert.ok(!after.json.some((i: any) => i.subject.id === projectId), 'post-mute: the viewer’s feed drops the actor')
  assert.ok(
    !store.listNotifications(AUDIENCE).some((x) => x.actor === ownerName),
    'the bell honors the earmuff too',
  )
  // Never a wall: the AUDIENCE can still read the subject itself.
  const stillReadable = await call('GET', `/projects/${projectId}/contributions`, undefined, { 'x-tenant-id': AUDIENCE })
  assert.equal(stillReadable.status, 200, 'a mute filters the viewer’s projections, not access')

  const unmuted = await call('PATCH', '/me/mutes', { name: ownerName, muted: false }, { 'x-tenant-id': AUDIENCE })
  assert.deepEqual(unmuted.json, [])
  const restored = await call('GET', '/commons', undefined, { 'x-tenant-id': AUDIENCE })
  assert.ok(restored.json.some((i: any) => i.subject.id === projectId), 'unmute restores the feed')
})

test('post standing rides the wire: canDelete = author OR anchor owner, and it matches the write path', async () => {
  // These flags are what the UI gates the retract / moderate / report acts on.
  // If they disagreed with the write path, a reader would be offered a delete
  // that 403s — or (the inverse, which is how the thread page's resolve control
  // went missing) never be offered one they hold.
  // This file's arena already opens a thread whose FIRST post is the audience's.
  const { d } = await arena()
  const pid = d.posts[0].id
  const face = async (tenant: string) =>
    (await call('GET', `/discussions/${d.id}`, undefined, { 'x-tenant-id': tenant })).json.posts[0]

  const asAuthor = await face(AUDIENCE)
  assert.equal(asAuthor.mine, true, 'their own words')
  assert.equal(asAuthor.canDelete, true, 'the author may retract')

  const asOwner = await face(OWNER)
  assert.notEqual(asOwner.mine, true, 'the anchor owner did not write it')
  assert.equal(asOwner.canDelete, true, '…and may still moderate their own surface')

  // The REDACTED face still holds: no raw tenant ids ride along.
  for (const seen of [asAuthor, asOwner]) {
    assert.ok(!JSON.stringify(seen).includes('tenant-'), 'no tenant id crosses the wire')
  }

  // …and the write path agrees with the face it advertised.
  assert.equal((await call('DELETE', `/discussions/${d.id}/posts/${pid}`, undefined, { 'x-tenant-id': BYSTANDER })).status, 404)
  assert.equal((await call('DELETE', `/discussions/${d.id}/posts/${pid}`, undefined, { 'x-tenant-id': OWNER })).status, 200)
})
