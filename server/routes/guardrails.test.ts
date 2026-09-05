/** S5 guardrails (docs/design/social-layer.md §2.5): owner moderation, report,
 *  and mutes. Invariants: a post is deletable by its AUTHOR or the ANCHOR
 *  OWNER, nobody else (existence-hiding for non-parties); deleting the last
 *  post removes the thread; a report rings the anchor owner (who holds the
 *  delete); a mute is a per-viewer EARMUFF — it filters the viewer's own feed
 *  and bell, and never touches the muted party's access. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from '../store/index.ts'
import { call } from '../testkit/http.ts'

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

test('report is durable and retry-safe, rings one exact moderation door, and retracts with the post', async () => {
  const { projectId, d } = await arena()
  const pid = d.posts[0].id
  const report = () => call(
    'POST',
    `/discussions/${d.id}/posts/${pid}/report`,
    undefined,
    { 'x-tenant-id': AUDIENCE },
  )
  assert.equal((await call(
    'POST',
    `/discussions/${d.id}/posts/${pid}/report`,
    { surprise: true },
    { 'x-tenant-id': AUDIENCE },
  )).status, 400)
  const first = await report()
  assert.equal(first.status, 200)
  assert.equal(first.json.ok, true)
  assert.equal(first.json.discussion.posts[0].reported, true, 'the reporter receives durable acknowledgement')
  const second = await report()
  assert.equal(second.status, 200)
  assert.equal(second.json.discussion.posts[0].reported, true, 'retry converges on the same receipt')

  const reports = store.listNotifications(OWNER).filter(
    (x) => x.kind === 'social.reported' && x.subjectId === projectId && x.discussionId === d.id,
  )
  assert.equal(reports.length, 1, 'one caller cannot duplicate the owner’s moderation bell')

  const anotherViewer = await call('GET', `/discussions/${d.id}`, undefined, { 'x-tenant-id': OWNER })
  assert.notEqual(anotherViewer.json.posts[0].reported, true, 'the report receipt remains viewer-relative')

  await call('DELETE', `/discussions/${d.id}/posts/${pid}`, undefined, { 'x-tenant-id': OWNER })
  assert.equal(
    store.listNotifications(OWNER).filter((x) => x.kind === 'social.reported' && x.discussionId === d.id).length,
    0,
    'removing the reported post retracts its now-stale moderation door',
  )
})

test('explicit endorsement state converges under retry while bodyless legacy calls still toggle', async () => {
  const { d } = await arena()
  const pid = d.posts[0].id
  const url = `/discussions/${d.id}/posts/${pid}/react`
  const headers = { 'x-tenant-id': OWNER }

  for (const suffix of ['first', 'retry']) {
    const response = await call('POST', url, { reacted: true }, {
      ...headers,
      'idempotency-key': `discussion-react-on-${d.id}-${suffix}`,
    })
    assert.equal(response.status, 200)
    assert.equal(response.json.posts[0].reacted, true)
    assert.equal(response.json.posts[0].reactions, 1)
  }
  for (const suffix of ['first', 'retry']) {
    const response = await call('POST', url, { reacted: false }, {
      ...headers,
      'idempotency-key': `discussion-react-off-${d.id}-${suffix}`,
    })
    assert.equal(response.status, 200)
    assert.notEqual(response.json.posts[0].reacted, true)
    assert.equal(response.json.posts[0].reactions, 0)
  }

  assert.equal((await call('POST', url, undefined, headers)).json.posts[0].reactions, 1)
  assert.equal((await call('POST', url, undefined, headers)).json.posts[0].reactions, 0)
  assert.equal((await call('POST', url, { reacted: 'yes' }, headers)).status, 400)
  assert.equal((await call('POST', url, { reacted: true, surprise: true }, headers)).status, 400)
})

test('resolve and reopen pin lifecycle revision, converge on desired state, and reject stale ABA writes', async () => {
  const { d } = await arena()
  const url = `/discussions/${d.id}/resolve`
  const headers = { 'x-tenant-id': OWNER }
  assert.equal(d.state, 'open')
  assert.equal(d.stateRevision, 0)

  const resolved = await call('POST', url, { state: 'resolved', expectedStateRevision: 0 }, headers)
  assert.equal(resolved.status, 200)
  assert.equal(resolved.json.state, 'resolved')
  assert.equal(resolved.json.stateRevision, 1)
  const converged = await call('POST', url, { state: 'resolved', expectedStateRevision: 0 }, headers)
  assert.equal(converged.status, 200, 'a stale replay that already reached its desired state is safe')
  assert.equal(converged.json.stateRevision, 1)

  const stale = await call('POST', url, { state: 'open', expectedStateRevision: 0 }, headers)
  assert.equal(stale.status, 409)
  const unchanged = await call('GET', `/discussions/${d.id}`, undefined, headers)
  assert.equal(unchanged.json.state, 'resolved')
  assert.equal(unchanged.json.stateRevision, 1)

  const reopened = await call('POST', url, { state: 'open', expectedStateRevision: 1 }, headers)
  assert.equal(reopened.status, 200)
  assert.equal(reopened.json.stateRevision, 2)
  assert.equal((await call('POST', url, { state: 'resolved', expectedStateRevision: -1 }, headers)).status, 400)
  assert.equal((await call('POST', url, { state: 'resolved', surprise: true }, headers)).status, 400)

  const legacy = await arena()
  const legacyResolved = await call('POST', `/discussions/${legacy.d.id}/resolve`, undefined, headers)
  assert.equal(legacyResolved.status, 200)
  assert.equal(legacyResolved.json.state, 'resolved', 'bodyless callers retain the original resolve default')
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

  // Nor does a mute unmake WHO SOMEBODY IS. The profile's publisher-existence
  // rule (S5) asks whether a name publishes anything the viewer can see — and
  // it asked the MUTED feed, so muting a workspace whose only public face was
  // its publishes made its profile 404 for the muter. Found by S7, when
  // following a muted name started returning "no such workspace". An earmuff
  // silences what someone says; it must never erase that they exist.
  const profile = await call('GET', `/directory/owners/${encodeURIComponent(ownerName)}`, undefined, { 'x-tenant-id': AUDIENCE })
  assert.equal(profile.status, 200, 'a muted workspace still has a profile')

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

test('reviewed cascade refuses a changed branch, then exact keyed deletion replays without widening', async () => {
  const { d } = await arena()
  const rootId = d.posts[0].id
  const firstReply = (
    await call(
      'POST',
      `/discussions/${d.id}/posts`,
      { body: 'First reviewed reply', replyTo: rootId },
      { 'x-tenant-id': OWNER },
    )
  ).json.posts.at(-1)
  const reviewedPostIds = [rootId, firstReply.id]

  const lateReply = (
    await call(
      'POST',
      `/discussions/${d.id}/posts`,
      { body: 'Arrived after confirmation', replyTo: firstReply.id },
      { 'x-tenant-id': OWNER },
    )
  ).json.posts.at(-1)
  const stale = await call(
    'DELETE',
    `/discussions/${d.id}/posts/${rootId}?cascade=1`,
    { expectedPostIds: reviewedPostIds },
    { 'x-tenant-id': OWNER, 'idempotency-key': `discussion-delete-stale-${d.id}` },
  )
  assert.equal(stale.status, 409)
  assert.match(stale.json.error.message, /branch changed/i)
  const unchanged = await call('GET', `/discussions/${d.id}`, undefined, { 'x-tenant-id': OWNER })
  assert.deepEqual(
    unchanged.json.posts.map((post: { id: string }) => post.id),
    [rootId, firstReply.id, lateReply.id],
    'conflict is all-or-nothing: even the originally reviewed rows remain',
  )

  const exactPostIds = [rootId, firstReply.id, lateReply.id]
  const headers = {
    'x-tenant-id': OWNER,
    'idempotency-key': `discussion-delete-exact-${d.id}`,
  }
  const deleted = await call(
    'DELETE',
    `/discussions/${d.id}/posts/${rootId}?cascade=1`,
    { expectedPostIds: exactPostIds },
    headers,
  )
  assert.equal(deleted.status, 200)
  assert.equal(deleted.json.discussion, null)
  const replay = await call(
    'DELETE',
    `/discussions/${d.id}/posts/${rootId}?cascade=1`,
    { expectedPostIds: exactPostIds },
    headers,
  )
  assert.equal(replay.status, deleted.status)
  assert.deepEqual(replay.json, deleted.json, 'same actor, target, body, and key replay the terminal acknowledgement')
  assert.equal(replay.headers['idempotency-replayed'], 'true')
})

test('reviewed deletion input is strict while omitted input keeps legacy narrow semantics', async () => {
  const { d } = await arena()
  const pid = d.posts[0].id
  const headers = { 'x-tenant-id': OWNER }
  assert.equal((await call(
    'DELETE',
    `/discussions/${d.id}/posts/${pid}`,
    { expectedPostIds: [pid], surprise: true },
    headers,
  )).status, 400)
  assert.equal((await call(
    'DELETE',
    `/discussions/${d.id}/posts/${pid}`,
    { expectedPostIds: [pid, pid] },
    headers,
  )).status, 400)
  assert.equal(
    (await call('DELETE', `/discussions/${d.id}/posts/${pid}`, undefined, headers)).status,
    200,
    'legacy callers retain the minimal-risk one-post delete',
  )
})
