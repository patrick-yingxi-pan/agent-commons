/** Discussion attachments are explicit, detached whole-thread copies. The
 * source wall is checked when a copy is captured or refreshed; after capture,
 * the destination conversation owns the copy and its ordinary reader wall. */
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { discussionContextId } from '../../contract/discussionSnapshot.ts'
import { attachmentPrompt } from '../attachmentInput.ts'
import { workspaceInputAttachments } from '../../contract/attachmentInput.ts'
import { store } from '../store/index.ts'
import { call } from '../testkit/http.ts'

const SOURCE = 'tenant-acme'
const DESTINATION = 'tenant-beta'
const READER = 'tenant-growthworks'
const BYSTANDER = 'tenant-post-stranger'
const EMPTY = { workspaces: [], repos: [], connectors: [], attachments: [] }
let sequence = 0

const headers = (tenant: string) => ({ 'x-tenant-id': tenant })

async function sourceThread(firstPost: string, tier: 'view' | 'comment' = 'view') {
  const id = `p-discussion-snapshot-${++sequence}`
  store.applyRelationOp({ kind: 'create-project', projectId: id, projectName: `Snapshot ${sequence}`, projectDescription: '' }, SOURCE)
  const grant = await call('POST', '/grants', {
    subject: { kind: 'project', id }, audience: { kind: 'org', orgId: DESTINATION }, tier,
  }, headers(SOURCE))
  assert.equal(grant.status, 200, 'the source project must be granted to the destination tenant')
  const opened = await call('POST', '/discussions', {
    anchor: { ref: { kind: 'project', id } }, firstPost,
  }, headers(SOURCE))
  assert.equal(opened.status, 200, 'the source discussion must exist before the attach path is exercised')
  return { projectId: id, grantId: grant.json.id, discussion: opened.json }
}

async function destination(tenant = DESTINATION) {
  const opened = await call('POST', '/sessions', { firstMessage: `Discussion snapshot destination ${++sequence}` }, headers(tenant))
  assert.equal(opened.status, 200)
  return opened.json.id as string
}

function staged(discussionId: string, label: string, discussionCaptureId = randomUUID()) {
  return { id: discussionContextId(discussionId), label, kind: 'discussion', discussionCaptureId }
}

function workspace(attachments: unknown[]) {
  return { ...EMPTY, attachments }
}

async function attach(sessionId: string, attachment: unknown, tenant = DESTINATION) {
  return call('PATCH', `/sessions/${sessionId}/context-state`, {
    operations: [], workspace: workspace([attachment]),
  }, headers(tenant))
}

async function revoke(grantId: string) {
  const response = await call('DELETE', `/grants/${grantId}`, undefined, headers(SOURCE))
  assert.equal(response.status, 200)
}

test('a staged draft reference captures the readable whole discussion on its first materialized context flush', async () => {
  const { discussion } = await sourceThread('A complete opening post')
  const reply = await call('POST', `/discussions/${discussion.id}/posts`, { body: 'A complete later reply' }, headers(SOURCE))
  assert.equal(reply.status, 200)
  const sid = await destination()
  const ref = staged(discussion.id, 'A complete opening post')

  const saved = await attach(sid, ref)
  assert.equal(saved.status, 200)
  assert.deepEqual(saved.json.contexts, [], 'a discussion copy is workspace data, not an effect-mediation binding')
  assert.deepEqual(store.sessionContexts(sid), [])
  assert.equal(saved.json.workspace.attachments.length, 1)
  const attachment = saved.json.workspace.attachments[0]
  assert.equal(attachment.id, discussionContextId(discussion.id))
  assert.equal(attachment.kind, 'discussion')
  assert.equal(attachment.discussionCaptureId, undefined)
  assert.deepEqual(Object.keys(attachment.discussionSnapshot).sort(), [
    'capturedAt', 'discussionId', 'postCount', 'snapshotId', 'text', 'title', 'version',
  ])
  assert.equal(attachment.discussionSnapshot.discussionId, discussion.id)
  assert.equal(attachment.discussionSnapshot.postCount, 2)
  assert.match(attachment.discussionSnapshot.text, /A complete opening post/)
  assert.match(attachment.discussionSnapshot.text, /A complete later reply/)
})

test('source edits do not live-update a saved copy; explicit refresh replaces only that target', async () => {
  const { discussion } = await sourceThread('Opening text')
  const sid = await destination()
  const attached = await attach(sid, staged(discussion.id, 'Opening text'))
  assert.equal(attached.status, 200)
  const original = attached.json.workspace.attachments[0].discussionSnapshot

  const reply = await call('POST', `/discussions/${discussion.id}/posts`, { body: 'A later source reply' }, headers(SOURCE))
  assert.equal(reply.status, 200)
  const another = await sourceThread('Unrelated discussion')
  const unrelatedRef = staged(another.discussion.id, 'Unrelated discussion')
  const unrelated = await call('PATCH', `/sessions/${sid}/context-state`, {
    operations: [], workspace: workspace([attached.json.workspace.attachments[0], unrelatedRef]),
  }, headers(DESTINATION))
  assert.equal(unrelated.status, 200)

  const afterEdit = store.sessionWorkspace(sid).attachments.find((item: any) => item.id === discussionContextId(discussion.id))
  assert.deepEqual(afterEdit.discussionSnapshot, original, 'editing the source and attaching elsewhere never triggers a live read')

  const requestId = randomUUID()
  const refreshed = await call('POST', `/sessions/${sid}/attachments/${encodeURIComponent(discussionContextId(discussion.id))}/refresh`, {
    expectedSnapshotId: original.snapshotId, requestId,
  }, headers(DESTINATION))
  assert.equal(refreshed.status, 200)
  const refreshedWorkspace = refreshed.json.workspace
  const refreshedAttachment = refreshedWorkspace.attachments.find((item: any) => item.id === discussionContextId(discussion.id))
  assert.notEqual(refreshedAttachment.discussionSnapshot.snapshotId, original.snapshotId)
  assert.equal(refreshedAttachment.discussionSnapshot.postCount, 2)
  assert.match(refreshedAttachment.discussionSnapshot.text, /A later source reply/)
  assert.deepEqual(
    refreshedWorkspace.attachments.find((item: any) => item.id === discussionContextId(another.discussion.id)).discussionSnapshot,
    unrelated.json.workspace.attachments.find((item: any) => item.id === discussionContextId(another.discussion.id)).discussionSnapshot,
    'refresh replaces only its target and preserves unrelated snapshots',
  )
})

test('refresh checks the current source grant for new work but request-ID replay survives later revocation', async () => {
  const { discussion, grantId } = await sourceThread('Refresh before revoke')
  const sid = await destination()
  const attached = await attach(sid, staged(discussion.id, 'Refresh before revoke'))
  assert.equal(attached.status, 200)
  const original = attached.json.workspace.attachments[0].discussionSnapshot
  await call('POST', `/discussions/${discussion.id}/posts`, { body: 'Visible at refresh time' }, headers(SOURCE))

  const request = { expectedSnapshotId: original.snapshotId, requestId: randomUUID() }
  const path = `/sessions/${sid}/attachments/${encodeURIComponent(discussionContextId(discussion.id))}/refresh`
  const first = await call('POST', path, request, headers(DESTINATION))
  assert.equal(first.status, 200)
  await revoke(grantId)
  assert.equal((await call('GET', `/discussions/${discussion.id}`, undefined, headers(DESTINATION))).status, 404,
    'the source has become unreadable to the destination tenant')

  const replay = await call('POST', path, { expectedSnapshotId: null, requestId: request.requestId }, headers(DESTINATION))
  assert.equal(replay.status, 200, 'the durable request-ID receipt is returned before rechecking source access')
  assert.deepEqual(replay.json.workspace, first.json.workspace)

  const staleStage = await call('PATCH', `/sessions/${sid}/context-state`, {
    operations: [], workspace: workspace([staged(discussion.id, 'Refresh before revoke')]),
  }, headers(DESTINATION))
  assert.equal(staleStage.status, 200, 'retrying the old staged draft ref is idempotent for an already-saved target')
  assert.deepEqual(staleStage.json.workspace.attachments[0].discussionSnapshot,
    first.json.workspace.attachments[0].discussionSnapshot, 'a stale stage cannot erase or rewind the saved copy')

  const fresh = await call('POST', path, { expectedSnapshotId: first.json.workspace.attachments[0].discussionSnapshot.snapshotId, requestId: randomUUID() }, headers(DESTINATION))
  assert.notEqual(fresh.status, 200, 'a new capture is refused after the source grant is revoked')
  assert.deepEqual(store.sessionWorkspace(sid), first.json.workspace, 'refusal preserves the saved destination copy')
})

test('new capture requires source visibility and destination ownership and refusal leaves the full workspace untouched', async () => {
  const { discussion, grantId } = await sourceThread('Private-to-this-audience opening')
  const sid = await destination()
  await attach(sid, { id: 'kept-file', label: 'Existing note', kind: 'file', source: { id: 'ui-host', kind: 'ui-host', label: 'This computer' }, previewText: 'keep me' })
  const before = store.sessionWorkspace(sid)

  await revoke(grantId)
  assert.equal((await call('GET', `/discussions/${discussion.id}`, undefined, headers(DESTINATION))).status, 404)
  const denied = await attach(sid, staged(discussion.id, 'Private-to-this-audience opening'))
  assert.notEqual(denied.status, 200)
  assert.deepEqual(store.sessionWorkspace(sid), before, 'an inaccessible source cannot partially alter either workspace facet')
  assert.deepEqual(store.sessionContexts(sid), [])

  const foreign = await call('PATCH', `/sessions/${sid}/context-state`, {
    operations: [], workspace: workspace([staged(discussion.id, 'Private-to-this-audience opening')]),
  }, headers(BYSTANDER))
  assert.equal(foreign.status, 404, 'a foreign destination remains existence-hidden')
  assert.deepEqual(store.sessionWorkspace(sid), before)
})

test('oversize transcripts are refused whole and do not create an attachment or binding', async () => {
  const { discussion } = await sourceThread('Oversized transcript opening')
  for (let index = 0; index < 40; index++) {
    const reply = await call('POST', `/discussions/${discussion.id}/posts`, { body: `${index}: ${'x'.repeat(1_990)}` }, headers(SOURCE))
    assert.equal(reply.status, 200, `source post ${index + 1} should be accepted into the fixture transcript`)
  }
  assert.equal(store.getDiscussion(discussion.id, SOURCE)?.posts.length, 41, 'the test source exceeds the transcript limit by multiple complete posts')
  const sid = await destination()
  const before = store.sessionWorkspace(sid)
  const result = await attach(sid, staged(discussion.id, 'Oversized transcript opening'))
  assert.notEqual(result.status, 200, 'a source exceeding the complete snapshot byte cap is refused')
  assert.deepEqual(store.sessionWorkspace(sid), before, 'no partial/truncated copy is committed')
  assert.deepEqual(store.sessionContexts(sid), [])
})

test('the saved copy excludes social-private metadata and remains readable/model input after source revocation', async () => {
  const { discussion, grantId } = await sourceThread('Public prose only')
  const reaction = await call('POST', `/discussions/${discussion.id}/posts/${discussion.posts[0].id}/react`, undefined, headers(DESTINATION))
  assert.equal(reaction.status, 200, 'the granted reader has a live viewer-relative reaction before capture')
  const cursor = await call('POST', `/discussions/${discussion.id}/read`, {}, headers(DESTINATION))
  assert.equal(cursor.status, 200, 'the granted reader has private read-cursor state before capture')
  const sid = await destination()
  const attached = await attach(sid, staged(discussion.id, 'Public prose only'))
  assert.equal(attached.status, 200)
  const snapshot = attached.json.workspace.attachments[0].discussionSnapshot
  const storedProjection = JSON.stringify(snapshot)
  assert.equal(storedProjection.includes(SOURCE), false, 'tenant identity is not copied into the saved transcript')
  assert.equal(storedProjection.includes('reactions'), false)
  assert.equal(storedProjection.includes('reported'), false)
  assert.equal(storedProjection.includes('readCursor'), false)

  const share = await call('POST', '/grants', {
    subject: { kind: 'session', id: sid }, audience: { kind: 'org', orgId: READER }, tier: 'view',
  }, headers(DESTINATION))
  assert.equal(share.status, 200)
  await revoke(grantId)
  assert.equal((await call('GET', `/discussions/${discussion.id}`, undefined, headers(DESTINATION))).status, 404)

  const deleted = await call('DELETE', `/discussions/${discussion.id}/posts/${discussion.posts[0].id}?cascade=1`, {
    expectedPostIds: [discussion.posts[0].id],
  }, headers(SOURCE))
  assert.equal(deleted.status, 200, 'the source owner can delete the original thread after revoking its grant')
  assert.equal(deleted.json.discussion, null, 'deleting the anchor post removes the source thread')

  const visible = await call('GET', `/sessions/${sid}`, undefined, headers(READER))
  assert.equal(visible.status, 200)
  const visibleAttachment = visible.json.workspace.attachments.find((item: any) => item.id === discussionContextId(discussion.id))
  assert.deepEqual(visibleAttachment.discussionSnapshot, snapshot, 'destination readers receive the durable saved copy')

  const modelInput = attachmentPrompt('Please summarize this discussion.', workspaceInputAttachments(visible.json.workspace))
  const framed = JSON.parse(modelInput.userText.slice(modelInput.userText.indexOf('\n\n') + 2))
  assert.deepEqual(framed.attached_files[0], {
    name: 'Public prose only', status: 'ready', kind: 'discussion',
    captured_at: snapshot.capturedAt, post_count: snapshot.postCount, text: snapshot.text,
  }, 'both model transports consume only the saved transcript projection')
})

test('missing source IDs fail as not found before any destination state is changed', async () => {
  const sid = await destination()
  const before = store.sessionWorkspace(sid)
  const absentDiscussionId = `discussion-that-does-not-exist-${randomUUID()}`
  const result = await attach(sid, staged(absentDiscussionId, 'Unavailable source'))
  assert.equal(result.status, 404)
  assert.deepEqual(store.sessionWorkspace(sid), before)
  assert.deepEqual(store.sessionContexts(sid), [])
})

test('a destination session reader cannot refresh its owner\'s saved Discussion copy', async () => {
  const { discussion } = await sourceThread('Owner-only refresh')
  const sid = await destination()
  const attached = await attach(sid, staged(discussion.id, 'Owner-only refresh'))
  assert.equal(attached.status, 200)
  const before = attached.json.workspace
  const share = await call('POST', '/grants', {
    subject: { kind: 'session', id: sid }, audience: { kind: 'org', orgId: READER }, tier: 'view',
  }, headers(DESTINATION))
  assert.equal(share.status, 200)

  const refreshPath = `/sessions/${sid}/attachments/${encodeURIComponent(discussionContextId(discussion.id))}/refresh`
  const denied = await call('POST', refreshPath, {
    expectedSnapshotId: before.attachments[0].discussionSnapshot.snapshotId,
    requestId: randomUUID(),
  }, headers(READER))
  assert.equal(denied.status, 403)
  assert.deepEqual(store.sessionWorkspace(sid), before)
})

test('Discussion refresh rejects frozen text/image snapshots and malformed refresh identities', async () => {
  const { discussion } = await sourceThread('Refresh payload shape')
  const sid = await destination()
  const attached = await attach(sid, staged(discussion.id, 'Refresh payload shape'))
  assert.equal(attached.status, 200)
  const original = attached.json.workspace.attachments[0].discussionSnapshot
  const path = `/sessions/${sid}/attachments/${encodeURIComponent(discussionContextId(discussion.id))}/refresh`
  const snapshotId = randomUUID()
  const frozenText = {
    version: 2, snapshotId, capturedAt: original.capturedAt, sourceId: 'cloud', path: 'notes.pdf', text: 'forged text',
    documentImport: { format: 'pdf', status: 'ready', pages: 1, textPages: 1 },
  }
  const frozenImage = {
    version: 1, snapshotId: randomUUID(), capturedAt: original.capturedAt, sourceId: 'cloud', path: 'photo.png',
    image: { id: `img-${'a'.repeat(64)}`, mimeType: 'image/png', width: 1, height: 1, byteLength: 68 },
  }
  for (const request of [
    { expectedSnapshotId: original.snapshotId, requestId: frozenText.snapshotId, snapshot: frozenText },
    { expectedSnapshotId: original.snapshotId, requestId: frozenImage.snapshotId, imageSnapshot: frozenImage },
    { expectedSnapshotId: 'not-a-snapshot-id', requestId: randomUUID() },
  ]) {
    const refused = await call('POST', path, request, headers(DESTINATION))
    assert.equal(refused.status, 400, `Discussion refresh refused an invalid payload: ${JSON.stringify(request)}`)
    assert.deepEqual(store.sessionWorkspace(sid).attachments[0].discussionSnapshot, original)
  }
})

test('valid but stale or forged replacement data cannot overwrite a previously saved transcript', async () => {
  const { discussion } = await sourceThread('Server-owned original')
  const sid = await destination()
  const attached = await attach(sid, staged(discussion.id, 'Server-owned original'))
  assert.equal(attached.status, 200)
  const original = attached.json.workspace.attachments[0]
  const forgedSnapshot = {
    ...original.discussionSnapshot,
    snapshotId: randomUUID(),
    text: '# Server-owned original\n\n[1] Forged author · 2026-01-01T00:00:00.000Z\nforged body',
  }
  const stale = await call('PATCH', `/sessions/${sid}/context-state`, {
    operations: [], workspace: workspace([{ ...original, discussionSnapshot: forgedSnapshot }]),
  }, headers(DESTINATION))
  assert.equal(stale.status, 200)
  const preserved = stale.json.workspace.attachments[0]
  assert.equal(preserved.label, original.label)
  assert.deepEqual(preserved.discussionSnapshot, original.discussionSnapshot,
    'ordinary workspace writes may update metadata but cannot mint/replace the saved copy')

  const forgedDiscussionId = `forged-${randomUUID()}`
  const newSnapshot = { ...forgedSnapshot, discussionId: forgedDiscussionId, snapshotId: randomUUID() }
  const newForged = await call('PATCH', `/sessions/${sid}/context-state`, {
    operations: [], workspace: workspace([{
      id: discussionContextId(forgedDiscussionId), label: newSnapshot.title, kind: 'discussion', discussionSnapshot: newSnapshot,
    }]),
  }, headers(DESTINATION))
  assert.notEqual(newForged.status, 200, 'a client cannot attach a purported server snapshot to a new id')
  assert.deepEqual(store.sessionWorkspace(sid).attachments, [preserved])
})

test('malformed staged references fail closed without state changes', async () => {
  const { discussion } = await sourceThread('Valid source')
  const sid = await destination()
  for (const malformed of [
    { ...staged(discussion.id, 'Valid source'), discussionCaptureId: 'not-a-uuid' },
    { ...staged(discussion.id, 'Valid source'), id: 'discussion::not%2fcanonical' },
    { ...staged(discussion.id, 'Valid source'), discussionSnapshot: { version: 1 } },
    { ...staged(discussion.id, 'Valid source'), extra: 'not a wire field' },
    { ...staged(discussion.id, 'Valid source'), source: { id: 'remote', kind: 'cloud', label: 'Remote' } },
  ]) {
    const result = await attach(sid, malformed)
    assert.equal(result.status, 400, `malformed Discussion attachment refused: ${JSON.stringify(malformed)}`)
    assert.deepEqual(store.sessionWorkspace(sid), { ...EMPTY, attachments: [] })
    assert.deepEqual(store.sessionContexts(sid), [])
  }
})
