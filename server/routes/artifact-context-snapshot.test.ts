import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { artifactContextId, artifactSnapshotText } from '../../contract/artifactSnapshot.ts'
import { discussionContextId } from '../../contract/discussionSnapshot.ts'
import { store } from '../store/index.ts'
import { call } from '../testkit/http.ts'

const OWNER = 'tenant-personal'
const READER = 'tenant-beta'
const DESTINATION_READER = 'tenant-growthworks'
const FOREIGN = 'tenant-post-stranger'
const EMPTY = { workspaces: [], repos: [], connectors: [], attachments: [] }
const headers = (tenant: string, extra: Record<string, string> = {}) => ({ 'x-tenant-id': tenant, ...extra })
let serial = 0

async function ownerSeatOrg() {
  const stamp = `${Date.now()}-${++serial}`
  const signup = await call('POST', '/auth/signup', {
    name: `Artifact Org Owner ${stamp}`, email: `artifact-org-owner-${stamp}@example.test`, password: `ArtifactOrg-${stamp}-password1`,
  })
  assert.equal(signup.status, 200, JSON.stringify(signup.json))
  const cookie = signup.headers['set-cookie']?.split(';')[0]
  assert.ok(cookie)
  const organization = await call('POST', '/orgs', { name: `Artifact Context Org ${stamp}` }, { cookie })
  assert.equal(organization.status, 201, JSON.stringify(organization.json))
  return { cookie, homeTenantId: signup.json.tenant.id as string, orgId: organization.json.id as string, stamp }
}

async function createDocument(text: string) {
  const key = `artifact-copy-create-${Date.now()}-${++serial}`
  const response = await call('POST', '/artifacts', {
    name: `artifact-copy-${Date.now()}-${serial}.md`, kind: 'doc', body: text,
  }, headers(OWNER, { 'idempotency-key': key }))
  assert.equal(response.status, 201, JSON.stringify(response.json))
  return response.json.artifact as { id: string; name: string }
}

async function createStructured(name: string, kind: 'sheet' | 'slide', body: unknown) {
  const key = `artifact-copy-structured-${Date.now()}-${++serial}`
  const response = await call('POST', '/artifacts', { name, kind, body }, headers(OWNER, { 'idempotency-key': key }))
  assert.equal(response.status, 201, JSON.stringify(response.json))
  return response.json.artifact as { id: string; name: string }
}

async function destination(tenant = READER) {
  const response = await call('POST', '/sessions', { firstMessage: `Artifact snapshot destination ${++serial}` }, headers(tenant))
  assert.equal(response.status, 200, JSON.stringify(response.json))
  return response.json.id as string
}

function staged(id: string, label: string) {
  return { id: artifactContextId(id), label, kind: 'artifact', artifactCaptureId: randomUUID() }
}

function workspace(attachments: unknown[]) { return { ...EMPTY, attachments } }

async function attach(sessionId: string, attachment: unknown, tenant = READER) {
  return call('PATCH', `/sessions/${sessionId}/context-state`, { operations: [], workspace: workspace([attachment]) }, headers(tenant))
}

test('Artifact copy captures the exact complete current body, is destination-shared, and changes only on explicit readable Refresh', async () => {
  const artifact = await createDocument('Original copy body.')
  const sourceGrant = await call('POST', '/grants', {
    subject: { kind: 'artifact', id: artifact.id }, audience: { kind: 'org', orgId: READER }, tier: 'view',
  }, headers(OWNER))
  assert.equal(sourceGrant.status, 200)
  const sid = await destination()
  const stagedAttachment = staged(artifact.id, artifact.name)
  const attached = await attach(sid, stagedAttachment)
  assert.equal(attached.status, 200, JSON.stringify(attached.json))
  assert.deepEqual(attached.json.contexts, [], 'a saved copy is workspace data, not an effect binding')
  const saved = attached.json.workspace.attachments[0]
  assert.deepEqual(Object.keys(saved).sort(), ['artifactSnapshot', 'id', 'kind', 'label'])
  assert.equal(saved.id, artifactContextId(artifact.id))
  assert.equal(saved.artifactSnapshot.artifactId, artifact.id)
  assert.equal(saved.artifactSnapshot.title, artifact.name)
  assert.equal(saved.artifactSnapshot.artifactKind, 'doc')
  assert.equal(saved.artifactSnapshot.revision, 0)
  assert.equal(saved.artifactSnapshot.body.blocks[0].p, 'Original copy body.')
  const sourceBody = store.artifactContent(OWNER)[artifact.id]!
  const { revision: _revision, ...expectedBody } = sourceBody
  assert.deepEqual(saved.artifactSnapshot.body, expectedBody, 'stable block identity and all body fields are copied exactly')
  assert.equal(artifactSnapshotText(saved.artifactSnapshot), JSON.stringify({
    title: artifact.name, artifactKind: 'doc', revision: 0, body: saved.artifactSnapshot.body,
  }))

  const staleIncomingCopy = structuredClone(saved.artifactSnapshot)
  staleIncomingCopy.snapshotId = randomUUID()
  staleIncomingCopy.body.blocks[0].p = 'Caller-supplied replacement must not win.'
  const genericRewrite = await attach(sid, {
    id: saved.id, label: saved.label, kind: 'artifact', artifactSnapshot: staleIncomingCopy,
  })
  assert.equal(genericRewrite.status, 200, JSON.stringify(genericRewrite.json))
  assert.deepEqual(genericRewrite.json.workspace.attachments[0].artifactSnapshot, saved.artifactSnapshot,
    'generic context replacement cannot overwrite the first store-captured body')

  const destinationGrant = await call('POST', '/grants', {
    subject: { kind: 'session', id: sid }, audience: { kind: 'org', orgId: DESTINATION_READER }, tier: 'view',
  }, headers(READER))
  assert.equal(destinationGrant.status, 200)
  const sharedDestination = await call('GET', `/sessions/${sid}`, undefined, headers(DESTINATION_READER))
  assert.equal(sharedDestination.status, 200)
  assert.deepEqual(sharedDestination.json.workspace.attachments[0].artifactSnapshot, saved.artifactSnapshot,
    'destination session readers receive the saved copy without source re-resolution')

  const edit = await call('PATCH', `/artifacts/${artifact.id}/content`, {
    block: 0, text: 'Updated source body.', expectedRevision: 0,
  }, headers(OWNER))
  assert.equal(edit.status, 200, JSON.stringify(edit.json))
  assert.deepEqual(store.sessionWorkspace(sid).attachments[0]?.artifactSnapshot, saved.artifactSnapshot,
    'source edits never live-update an attached copy')

  const refreshPath = `/sessions/${sid}/attachments/${encodeURIComponent(artifactContextId(artifact.id))}/refresh`
  const request = { expectedSnapshotId: saved.artifactSnapshot.snapshotId, requestId: randomUUID() }
  const staleRefresh = await call('POST', refreshPath, { expectedSnapshotId: randomUUID(), requestId: randomUUID() }, headers(READER))
  assert.equal(staleRefresh.status, 409, 'a stale refresh receipt conflicts before capture')
  assert.deepEqual(store.sessionWorkspace(sid).attachments[0]?.artifactSnapshot, saved.artifactSnapshot)
  const sharedReaderRefresh = await call('POST', refreshPath, { expectedSnapshotId: saved.artifactSnapshot.snapshotId, requestId: randomUUID() }, headers(DESTINATION_READER))
  assert.equal(sharedReaderRefresh.status, 403, 'a reader of a shared destination cannot refresh its saved copy')
  assert.deepEqual(store.sessionWorkspace(sid).attachments[0]?.artifactSnapshot, saved.artifactSnapshot)
  const refreshed = await call('POST', refreshPath, request, headers(READER))
  assert.equal(refreshed.status, 200, JSON.stringify(refreshed.json))
  const refreshedCopy = refreshed.json.workspace.attachments[0].artifactSnapshot
  assert.equal(refreshedCopy.revision, 1)
  assert.equal(refreshedCopy.body.blocks[0].p, 'Updated source body.')
  assert.notEqual(refreshedCopy.snapshotId, saved.artifactSnapshot.snapshotId)

  assert.equal((await call('DELETE', `/grants/${sourceGrant.json.id}`, undefined, headers(OWNER))).status, 200)
  assert.equal((await call('GET', '/artifact-content', undefined, headers(READER))).json[artifact.id], undefined,
    'revocation closes the current source body')
  const replay = await call('POST', refreshPath, { expectedSnapshotId: null, requestId: request.requestId }, headers(READER))
  assert.equal(replay.status, 200, 'the same acknowledged Refresh receipt is replayable after source revocation')
  assert.deepEqual(replay.json.workspace.attachments[0].artifactSnapshot, refreshedCopy)
  const fresh = await call('POST', refreshPath, {
    expectedSnapshotId: refreshedCopy.snapshotId, requestId: randomUUID(),
  }, headers(READER))
  assert.equal(fresh.status, 404, 'a new Refresh rechecks source readability without revealing the source')
  assert.deepEqual(store.sessionWorkspace(sid).attachments[0]?.artifactSnapshot, refreshedCopy,
    'a denied Refresh leaves the destination copy intact')
  const representedAttach = await attach(sid, staged(artifact.id, artifact.name))
  assert.equal(representedAttach.status, 200, 'reattaching an already represented source does not re-read it')
  assert.deepEqual(representedAttach.json.workspace.attachments[0].artifactSnapshot, refreshedCopy,
    'represented saved copies survive source revocation unchanged')
  const afterSourceRevocation = await call('GET', `/sessions/${sid}`, undefined, headers(DESTINATION_READER))
  assert.deepEqual(afterSourceRevocation.json.workspace.attachments[0].artifactSnapshot, refreshedCopy,
    'destination readers retain the copy independently of the source grant')
})

test('Artifact snapshot capture refuses unreadable sources, foreign destinations, forged copies, and unsupported bodies', async () => {
  const artifact = await createDocument('Private source.')
  const sid = await destination()
  const before = store.sessionWorkspace(sid)
  const denied = await attach(sid, staged(artifact.id, artifact.name))
  assert.equal(denied.status, 404, 'a source without current read access is existence-hidden')
  assert.deepEqual(store.sessionWorkspace(sid), before)
  const foreign = await call('PATCH', `/sessions/${sid}/context-state`, {
    operations: [], workspace: workspace([staged(artifact.id, artifact.name)]),
  }, headers(FOREIGN))
  assert.equal(foreign.status, 404, 'foreign destination existence remains hidden')
  assert.deepEqual(store.sessionWorkspace(sid), before)

  const forged = await attach(sid, {
    id: artifactContextId(artifact.id), label: artifact.name, kind: 'artifact',
    artifactSnapshot: { version: 1, snapshotId: randomUUID(), capturedAt: '2026-10-08T00:00:00.000Z', artifactId: artifact.id,
      title: artifact.name, artifactKind: 'doc', revision: 0, body: { type: 'doc', title: 'Forged', blocks: [{ id: 'fake', p: 'forged content' }] } },
  })
  assert.equal(forged.status, 400, 'callers cannot supply a saved body as a new copy')
  assert.deepEqual(store.sessionWorkspace(sid), before)

  const stamp = `${Date.now()}-${++serial}`
  const metadataOnly = await call('POST', '/relations/ops', {
    op: { kind: 'save-artifact', artifact: { name: `snapshot-metadata-only-${stamp}.sheet`, kind: 'sheet', meta: 'Sheet' } },
  }, headers(OWNER, { 'idempotency-key': `snapshot-metadata-only-${stamp}` }))
  assert.equal(metadataOnly.status, 200, JSON.stringify(metadataOnly.json))
  const metadataRow = (metadataOnly.json.extraArtifacts as Array<{ id: string; name: string }>).find((row) => row.name === `snapshot-metadata-only-${stamp}.sheet`)
  assert.ok(metadataRow)
  assert.equal((await call('GET', `/artifacts/${metadataRow.id}`, undefined, headers(OWNER))).status, 200,
    'the bodyless metadata row is readable by its owner')
  assert.equal(store.artifactContent(OWNER)[metadataRow.id], undefined)
  const ownerDestination = await destination(OWNER)
  const beforeMetadataCapture = store.sessionWorkspace(ownerDestination)
  const refused = await attach(ownerDestination, staged(metadataRow.id, metadataRow.name), OWNER)
  assert.equal(refused.status, 400, JSON.stringify(refused.json))
  assert.equal(refused.json.error.code, 'bad_request')
  assert.match(refused.json.error.message, /no supported saved body/i)
  assert.deepEqual(store.sessionWorkspace(ownerDestination), beforeMetadataCapture,
    'a readable metadata-only row cannot mint a fallback snapshot or mutate its destination')
})

test('all five canonical Artifact body families are captured without a narrower fallback projection', async () => {
  const stamp = `${Date.now()}-${++serial}`
  const workbookBody = { type: 'workbook', sheets: [{ id: 'tab-1', name: 'Actuals', columns: ['Metric'], rows: [['42']], note: 'saved note' }] }
  const sheetBody = { type: 'sheet', columns: ['Metric'], rows: [['42']], note: 'saved note' }
  const slidesBody = { type: 'slides', slides: [{ title: 'Launch', bullets: ['Exact bullet'] }] }
  const doc = await createDocument(`Document family ${stamp}.`)
  const sheet = await createStructured(`Sheet family ${stamp}.csv`, 'sheet', sheetBody)
  const workbook = await createStructured(`Workbook family ${stamp}.xlsx`, 'sheet', workbookBody)
  const slides = await createStructured(`Slides family ${stamp}.slides`, 'slide', slidesBody)
  const library = store.artifactContent(OWNER)
  const figure = store.listArtifacts(OWNER).find((row) => row.kind === 'image' && library[row.id]?.type === 'figure')
  assert.ok(figure, 'the test owner has an existing canonical Figure body')
  const cases = [
    [doc, 'doc'], [sheet, 'sheet'], [workbook, 'workbook'], [slides, 'slides'], [figure, 'figure'],
  ] as const
  for (const [artifact, expectedType] of cases) {
    const sid = await destination(OWNER)
    const response = await attach(sid, staged(artifact.id, artifact.name), OWNER)
    assert.equal(response.status, 200, JSON.stringify(response.json))
    const saved = response.json.workspace.attachments[0].artifactSnapshot
    const source = store.artifactContent(OWNER)[artifact.id]!
    const { revision: _revision, ...expectedBody } = source
    assert.equal(saved.body.type, expectedType, `${artifact.name} keeps its full canonical body family`)
    assert.deepEqual(saved.body, expectedBody)
    assert.equal(store.sessionWorkspace(sid).attachments.length, 1)
  }
})

test('source Trash closes new Artifact snapshots but leaves an existing destination copy unchanged', async () => {
  const artifact = await createDocument('Body before Trash.')
  const grant = await call('POST', '/grants', {
    subject: { kind: 'artifact', id: artifact.id }, audience: { kind: 'org', orgId: READER }, tier: 'view',
  }, headers(OWNER))
  assert.equal(grant.status, 200)
  const sid = await destination()
  const attached = await attach(sid, staged(artifact.id, artifact.name))
  assert.equal(attached.status, 200, JSON.stringify(attached.json))
  const saved = attached.json.workspace.attachments[0].artifactSnapshot
  const trashed = await call('PATCH', `/artifacts/${artifact.id}/lifecycle`, { state: 'trashed', expectedRevision: 0 }, headers(OWNER))
  assert.equal(trashed.status, 200)
  const refresh = await call('POST', `/sessions/${sid}/attachments/${encodeURIComponent(artifactContextId(artifact.id))}/refresh`, {
    expectedSnapshotId: saved.snapshotId, requestId: randomUUID(),
  }, headers(READER))
  assert.equal(refresh.status, 404, 'Trash removes current source readability for capture')
  assert.deepEqual(store.sessionWorkspace(sid).attachments[0]?.artifactSnapshot, saved,
    'source Trash cannot delete or replace the detached saved copy')
})

test('an oversized but otherwise valid authored body is refused whole without changing its destination', async () => {
  const columns = Array.from({ length: 32 }, (_, index) => index === 0 ? 'CC' : 'C')
  const cells = Array.from({ length: 200 * 32 }, () => '雪')
  for (let index = 0; index < 6; index++) cells[index] = '雪'.repeat(1_939)
  cells[6] = '雪'.repeat(1_940)
  const rows = Array.from({ length: 200 }, (_, row) => cells.slice(row * 32, (row + 1) * 32))
  const body = { type: 'sheet', columns, rows }
  const authoredChars = columns.reduce((sum, value) => sum + value.length, 0) + cells.reduce((sum, value) => sum + value.length, 0)
  assert.equal(authoredChars, 20_000, 'the body is exactly at the authoring limit')
  const artifact = await createStructured(`oversized-snapshot-${Date.now()}-${++serial}.csv`, 'sheet', body)
  const sid = await destination(OWNER)
  const before = store.sessionWorkspace(sid)
  const refused = await attach(sid, staged(artifact.id, artifact.name), OWNER)
  assert.equal(refused.status, 400, JSON.stringify(refused.json))
  assert.match(refused.json.error.message, /complete supported Artifact body within the 64 KB limit/i)
  assert.deepEqual(store.sessionWorkspace(sid), before, 'oversized copies are never truncated or partially committed')
})

test('an org owner-seat actor captures and refreshes home-readable Artifact and Discussion copies, then source Trash closes refresh', async () => {
  const actor = await ownerSeatOrg()
  const created = await call('POST', '/artifacts', {
    name: `home-readable-${actor.stamp}.md`, kind: 'doc', body: 'Home tenant source revision zero.',
  }, { cookie: actor.cookie, 'idempotency-key': `home-readable-artifact-${actor.stamp}` })
  assert.equal(created.status, 201, JSON.stringify(created.json))
  const artifact = created.json.artifact as { id: string; name: string }

  // Authenticated users remain in their home namespace; this is a real org-owned
  // destination row edited through the same owner-seat route predicate.
  const artifactSession = store.createSession('Org destination for Artifact copy', actor.orgId)
  assert.equal(store.sessionOwnedBy(artifactSession, actor.homeTenantId), true)
  const artifactAttached = await call('PATCH', `/sessions/${artifactSession.id}/context-state`, {
    operations: [], workspace: workspace([staged(artifact.id, artifact.name)]),
  }, { cookie: actor.cookie })
  assert.equal(artifactAttached.status, 200, JSON.stringify(artifactAttached.json))
  const originalArtifactCopy = artifactAttached.json.workspace.attachments[0].artifactSnapshot
  assert.equal(originalArtifactCopy.body.blocks[0].p, 'Home tenant source revision zero.')

  const edited = await call('PATCH', `/artifacts/${artifact.id}/content`, {
    block: 0, text: 'Home tenant source revision one.', expectedRevision: 0,
  }, { cookie: actor.cookie })
  assert.equal(edited.status, 200, JSON.stringify(edited.json))
  const artifactRefreshPath = `/sessions/${artifactSession.id}/attachments/${encodeURIComponent(artifactContextId(artifact.id))}/refresh`
  const artifactRefreshKey = randomUUID()
  const artifactRefreshed = await call('POST', artifactRefreshPath, {
    expectedSnapshotId: originalArtifactCopy.snapshotId, requestId: artifactRefreshKey,
  }, { cookie: actor.cookie })
  assert.equal(artifactRefreshed.status, 200, JSON.stringify(artifactRefreshed.json))
  const refreshedArtifactCopy = artifactRefreshed.json.workspace.attachments[0].artifactSnapshot
  assert.equal(refreshedArtifactCopy.body.blocks[0].p, 'Home tenant source revision one.')

  const thread = await call('POST', '/discussions', {
    anchor: { ref: { kind: 'artifact', id: artifact.id } }, firstPost: 'Home tenant discussion opening.',
  }, { cookie: actor.cookie })
  assert.equal(thread.status, 200, JSON.stringify(thread.json))
  const discussionSession = store.createSession('Org destination for Discussion copy', actor.orgId)
  assert.equal(store.sessionOwnedBy(discussionSession, actor.homeTenantId), true)
  const discussionAttachmentId = discussionContextId(thread.json.id as string)
  const discussionAttached = await call('PATCH', `/sessions/${discussionSession.id}/context-state`, {
    operations: [], workspace: workspace([{
      id: discussionAttachmentId, label: 'Home tenant discussion', kind: 'discussion', discussionCaptureId: randomUUID(),
    }]),
  }, { cookie: actor.cookie })
  assert.equal(discussionAttached.status, 200, JSON.stringify(discussionAttached.json))
  const originalDiscussionCopy = discussionAttached.json.workspace.attachments[0].discussionSnapshot
  assert.match(originalDiscussionCopy.text, /Home tenant discussion opening\./)
  const reply = await call('POST', `/discussions/${thread.json.id}/posts`, { body: 'Home tenant discussion update.' }, { cookie: actor.cookie })
  assert.equal(reply.status, 200)
  const discussionRefreshPath = `/sessions/${discussionSession.id}/attachments/${encodeURIComponent(discussionAttachmentId)}/refresh`
  const discussionRefreshKey = randomUUID()
  const discussionRefreshed = await call('POST', discussionRefreshPath, {
    expectedSnapshotId: originalDiscussionCopy.snapshotId, requestId: discussionRefreshKey,
  }, { cookie: actor.cookie })
  assert.equal(discussionRefreshed.status, 200, JSON.stringify(discussionRefreshed.json))
  const refreshedDiscussionCopy = discussionRefreshed.json.workspace.attachments[0].discussionSnapshot
  assert.match(refreshedDiscussionCopy.text, /Home tenant discussion update\./)

  const trashed = await call('PATCH', `/artifacts/${artifact.id}/lifecycle`, {
    state: 'trashed', expectedRevision: 0,
  }, { cookie: actor.cookie })
  assert.equal(trashed.status, 200, JSON.stringify(trashed.json))
  const refusedArtifactRefresh = await call('POST', artifactRefreshPath, {
    expectedSnapshotId: refreshedArtifactCopy.snapshotId, requestId: randomUUID(),
  }, { cookie: actor.cookie })
  assert.equal(refusedArtifactRefresh.status, 404, 'source Trash closes new Artifact capture while retaining the old copy')
  assert.deepEqual(store.sessionWorkspace(artifactSession.id).attachments[0]?.artifactSnapshot, refreshedArtifactCopy)
  const refusedDiscussionRefresh = await call('POST', discussionRefreshPath, {
    expectedSnapshotId: refreshedDiscussionCopy.snapshotId, requestId: randomUUID(),
  }, { cookie: actor.cookie })
  assert.equal(refusedDiscussionRefresh.status, 404, 'anchored Discussion visibility also closes with source Trash')
  assert.deepEqual(store.sessionWorkspace(discussionSession.id).attachments[0]?.discussionSnapshot, refreshedDiscussionCopy)
})

test('an exact readable Figure body is captured losslessly instead of reducing to image metadata', async () => {
  const library = store.artifactContent(OWNER)
  const figureRow = store.listArtifacts(OWNER).find((row) => row.kind === 'image' && library[row.id]?.type === 'figure')
  assert.ok(figureRow, 'the seeded owner world provides a canonical saved Figure body')
  const sourceBody = library[figureRow.id]
  assert.equal(sourceBody?.type, 'figure')
  const grant = await call('POST', '/grants', {
    subject: { kind: 'artifact', id: figureRow.id }, audience: { kind: 'org', orgId: READER }, tier: 'view',
  }, headers(OWNER))
  assert.equal(grant.status, 200)
  const sid = await destination()
  const attached = await attach(sid, staged(figureRow.id, figureRow.name))
  assert.equal(attached.status, 200, JSON.stringify(attached.json))
  const snapshot = attached.json.workspace.attachments[0].artifactSnapshot
  assert.equal(snapshot.artifactKind, 'image')
  assert.equal(snapshot.body.type, 'figure')
  const { revision: _revision, ...expectedBody } = sourceBody!
  assert.deepEqual(snapshot.body, expectedBody)
})
