/** Served-file snapshots are explicit saved copies: intake and Refresh are the
 * only read doors, and refreshing a session attachment is owner-only. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from '../store/index.ts'
import { call, callFresh } from '../testkit/http.ts'
import { buildRouter } from './index.ts'
import type { ServedTextSnapshot, ServedTextSnapshotV2 } from '../../contract/servedTextSnapshot.ts'

const SOURCE = { id: 'cloud', kind: 'cloud' as const, label: 'Cloud storage' }
const EMPTY = { workspaces: [], repos: [], connectors: [], attachments: [] }
const FIRST_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const REQUEST_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const RETRY_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const PNG_DATA = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
let sequence = 0

function snapshot(overrides: Partial<ServedTextSnapshot> = {}): ServedTextSnapshot {
  return {
    version: 1,
    snapshotId: FIRST_ID,
    capturedAt: '2026-10-04T12:00:00.000Z',
    sourceId: 'cloud',
    path: 'notes.md',
    text: 'captured file contents',
    ...overrides,
  }
}

function documentSnapshot(overrides: Partial<ServedTextSnapshotV2> = {}): ServedTextSnapshotV2 {
  return {
    version: 2,
    snapshotId: REQUEST_ID,
    capturedAt: '2026-10-04T12:01:00.000Z',
    sourceId: 'cloud',
    path: 'brief.pdf',
    text: 'extracted document text',
    documentImport: { format: 'pdf', status: 'ready', pages: 2, textPages: 2 },
    ...overrides,
  }
}

function attachment(id = 'cloud::notes.md', overrides: Record<string, unknown> = {}) {
  const result: Record<string, unknown> = {
    id,
    label: 'notes.md',
    kind: 'file',
    source: SOURCE,
    previewText: 'ordinary preview, not a saved copy',
    ...overrides,
  }
  if (Object.hasOwn(overrides, 'textSnapshot') && !Object.hasOwn(overrides, 'previewText')) delete result.previewText
  return result
}

async function ownedSession() {
  const tenant = `snapshot-owner-${++sequence}`
  const session = store.createSession(`served snapshot ${sequence}`, tenant)
  const headers = { 'x-tenant-id': tenant }
  return { id: session.id, tenant, headers }
}

function countSnapshotReads(t: { mock: { method: (...args: any[]) => unknown } }, result: (sourceId: string, path: string, snapshotId?: string) => ServedTextSnapshot | undefined) {
  const reads: Array<[string, string, string | undefined]> = []
  t.mock.method(store, 'fsSnapshot', (sourceId: string, path: string, snapshotId?: string) => {
    reads.push([sourceId, path, snapshotId])
    return result(sourceId, path, snapshotId)
  })
  return reads
}

async function attach(sid: string, headers: Record<string, string>, attachments: unknown[], contexts: Array<{ id: string; type: string; label: string }> = []) {
  const workspace = { ...EMPTY, attachments }
  return call('PATCH', `/sessions/${sid}/context-state`, {
    operations: contexts.map((context) => ({ action: 'attach', context })),
    workspace,
  }, headers)
}

function refresh(sid: string, attachmentId: string, expectedSnapshotId: string | null, requestId: string, headers: Record<string, string>) {
  return call('POST', `/sessions/${sid}/attachments/${encodeURIComponent(attachmentId)}/refresh`, { expectedSnapshotId, requestId }, headers)
}

function refreshDocument(sid: string, attachmentId: string, expectedSnapshotId: string | null, snapshot: ServedTextSnapshotV2, headers: Record<string, string>) {
  return call('POST', `/sessions/${sid}/attachments/${encodeURIComponent(attachmentId)}/refresh`, {
    expectedSnapshotId, requestId: snapshot.snapshotId, snapshot,
  }, headers)
}

function servedImageSnapshot(image: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    snapshotId: REQUEST_ID,
    capturedAt: '2026-10-04T12:02:00.000Z',
    sourceId: 'cloud',
    path: 'photos/cover.png',
    image,
    ...overrides,
  }
}

async function uploadImage(tenant: string, png = PNG_DATA) {
  const data = Buffer.from(png, 'base64')
  return call('POST', '/image-assets', {
    mimeType: 'image/png', data: png, width: 1, height: 1, byteLength: data.byteLength,
  }, { 'x-tenant-id': tenant })
}

function refreshImage(sid: string, attachmentId: string, expectedSnapshotId: string | null, imageSnapshot: unknown, headers: Record<string, string>) {
  return call('POST', `/sessions/${sid}/attachments/${encodeURIComponent(attachmentId)}/refresh`, {
    expectedSnapshotId,
    requestId: (imageSnapshot as { snapshotId: string }).snapshotId,
    imageSnapshot,
  }, headers)
}

function refreshWithHeldBody(sid: string, attachmentId: string, snapshot: ServedTextSnapshotV2, headers: Record<string, string>) {
  const router = buildRouter()
  const path = `/sessions/${sid}/attachments/${encodeURIComponent(attachmentId)}/refresh`
  let dataHandler: ((chunk: Uint8Array) => void) | undefined
  let endHandler: (() => void) | undefined
  let bodyRequested!: () => void
  const waitingForBody = new Promise<void>((resolve) => { bodyRequested = resolve })
  let status = 0
  let responseBody = ''
  const req: any = {
    method: 'POST', headers,
    on(event: string, handler: (chunk?: Uint8Array) => void) {
      if (event === 'data') dataHandler = handler as (chunk: Uint8Array) => void
      if (event === 'end') { endHandler = handler as () => void; bodyRequested() }
      return req
    },
  }
  const res: any = {
    writeHead(code: number) { status = code; return res },
    setHeader() {},
    write(chunk: string) { responseBody += chunk; return true },
    end(chunk?: string) { if (chunk) responseBody += chunk },
    flushHeaders() {}, on() {},
    get writableEnded() { return status !== 0 },
  }
  const dispatch = router.handle(req, res, new URL(`http://test${path}`))
  return {
    waitingForBody,
    release() {
      dataHandler?.(Buffer.from(JSON.stringify({ expectedSnapshotId: null, requestId: snapshot.snapshotId, snapshot })))
      endHandler?.()
    },
    async result() {
      await dispatch
      return { status, json: responseBody ? JSON.parse(responseBody) : undefined }
    },
  }
}

test('GET snapshot can be attached and explicitly refreshed, preserving the other workspace and contexts', async (t) => {
  const owner = await ownedSession()
  const reads = countSnapshotReads(t, (_source, path, id) => snapshot({ path, snapshotId: id ?? FIRST_ID, text: id ? 'new captured copy' : 'captured file contents' }))
  const intake = await call('GET', '/fs/snapshot?source=cloud&path=notes.md', undefined, owner.headers)
  assert.equal(intake.status, 200)
  assert.deepEqual(intake.json, snapshot())

  const other = attachment('cloud::other.md', { label: 'other.md', previewText: 'keep this attachment' })
  const initial = await attach(owner.id, owner.headers, [attachment('cloud::notes.md', { textSnapshot: intake.json }), other], [
    { id: 'context-keep', type: 'repo', label: 'Repository' },
  ])
  assert.equal(initial.status, 200)
  const beforeContexts = structuredClone(initial.json.contexts)
  const beforeOther = structuredClone(initial.json.workspace.attachments[1])

  const result = await refresh(owner.id, 'cloud::notes.md', FIRST_ID, REQUEST_ID, owner.headers)
  assert.equal(result.status, 200)
  assert.deepEqual(result.json.contexts, beforeContexts)
  assert.deepEqual(result.json.workspace.attachments[0], {
    id: 'cloud::notes.md', label: 'notes.md', kind: 'file', source: SOURCE,
    textSnapshot: snapshot({ snapshotId: REQUEST_ID, text: 'new captured copy' }),
  }, 'refresh replaces preview with the captured textSnapshot only')
  assert.deepEqual(result.json.workspace.attachments[1], beforeOther, 'unrelated attachment survives')
  assert.deepEqual(reads, [
    ['cloud', 'notes.md', undefined],
    ['cloud', 'notes.md', REQUEST_ID],
  ])

  const replay = await callFresh('POST', `/sessions/${owner.id}/attachments/cloud%3A%3Anotes.md/refresh`, {
    expectedSnapshotId: FIRST_ID, requestId: REQUEST_ID,
  }, owner.headers)
  assert.equal(replay.status, 200)
  assert.deepEqual(replay.json, result.json, 'replay after rebuilding the route table returns current represented state')
  assert.equal(reads.length, 2, 'represented request replays without another source read')
})

test('document Refresh commits only frozen renderer text, replays exact bytes, and rejects changed bytes', async (t) => {
  const owner = await ownedSession()
  const sourceAttachment = attachment('cloud::brief.pdf', { label: 'brief.pdf' })
  assert.equal((await attach(owner.id, owner.headers, [sourceAttachment])).status, 200)
  const frozen = documentSnapshot()
  const reads = countSnapshotReads(t, () => { throw new Error('v2 Refresh must not recapture server text') })

  const first = await refreshDocument(owner.id, sourceAttachment.id, null, frozen, owner.headers)
  assert.equal(first.status, 200)
  assert.deepEqual(first.json.workspace.attachments[0].textSnapshot, frozen)
  assert.equal(first.json.workspace.attachments[0].documentImport, undefined)
  assert.equal(first.json.workspace.attachments[0].previewText, undefined)
  assert.equal(reads.length, 0, 'raw bytes and source text are never read by the backend Refresh commit')

  const staleWorkspace = { ...EMPTY, attachments: [sourceAttachment] }
  const staleProjection = await call('PATCH', `/sessions/${owner.id}/context-state`, {
    operations: [], workspace: staleWorkspace,
  }, owner.headers)
  assert.equal(staleProjection.status, 200)
  assert.deepEqual(staleProjection.json.workspace.attachments[0].textSnapshot, frozen,
    'a stale full workspace projection cannot rewind an already-saved document')

  const replay = await refreshDocument(owner.id, sourceAttachment.id, null, frozen, owner.headers)
  assert.equal(replay.status, 200)
  assert.deepEqual(replay.json.workspace.attachments[0].textSnapshot, frozen)
  const changed = documentSnapshot({ text: 'different extracted text' })
  const conflict = await refreshDocument(owner.id, sourceAttachment.id, null, changed, owner.headers)
  assert.equal(conflict.status, 409)
  assert.deepEqual(store.sessionWorkspace(owner.id)?.attachments[0]?.textSnapshot, frozen)
})

test('served image Refresh commits only an owned immutable asset reference and replays the exact receipt', async (t) => {
  const owner = await ownedSession()
  const target = attachment('cloud::photos/cover.png', {
    label: 'cover.png', kind: 'photo', previewText: undefined, previewUrl: 'https://example.test/old-preview.png',
  })
  assert.equal((await attach(owner.id, owner.headers, [target])).status, 200)
  const uploaded = await uploadImage(owner.tenant)
  assert.equal(uploaded.status, 200)
  const frozen = servedImageSnapshot(uploaded.json)
  const reads = countSnapshotReads(t, () => { throw new Error('served image Refresh must not use text capture') })

  const first = await refreshImage(owner.id, target.id, null, frozen, owner.headers)
  assert.equal(first.status, 200)
  assert.deepEqual(first.json.workspace.attachments[0].imageSnapshot, frozen)
  assert.equal(first.json.workspace.attachments[0].image, undefined, 'served bytes are represented once by their nested asset ref')
  assert.equal(first.json.workspace.attachments[0].previewText, undefined)
  assert.equal(first.json.workspace.attachments[0].previewUrl, undefined, 'saving removes an older preview URL')
  assert.equal(reads.length, 0)

  const staleProjection = await attach(owner.id, owner.headers, [{ ...target, kind: 'file' }])
  assert.equal(staleProjection.status, 200)
  assert.deepEqual(staleProjection.json.workspace.attachments[0].imageSnapshot, frozen,
    'an ordinary stale workspace replacement cannot rewind a saved image')
  assert.equal(staleProjection.json.workspace.attachments[0].kind, 'photo', 'a stale projection cannot change the saved image attachment kind')
  assert.equal(staleProjection.json.workspace.attachments[0].previewUrl, undefined)

  const revoked = t.mock.method(store, 'fsReadPermitted', () => false)
  const savedProjection = await attach(owner.id, owner.headers, [{ ...target, previewUrl: undefined, imageSnapshot: frozen }])
  assert.equal(savedProjection.status, 200, 'an existing receipt survives unrelated projections after its source grant is revoked')
  assert.deepEqual(savedProjection.json.workspace.attachments[0].imageSnapshot, frozen)
  assert.equal(revoked.mock.callCount(), 0, 'a represented receipt is not re-authorized as a fresh capture')
  const replay = await refreshImage(owner.id, target.id, null, frozen, owner.headers)
  assert.equal(replay.status, 200, 'exact acknowledgement recovery survives a later grant revocation')
  assert.deepEqual(replay.json.workspace.attachments[0].imageSnapshot, frozen)
  assert.equal(revoked.mock.callCount(), 0, 'represented replay requires neither a source grant check nor a source read')

  const changed = servedImageSnapshot(uploaded.json, { capturedAt: '2026-10-04T12:03:00.000Z' })
  assert.equal((await refreshImage(owner.id, target.id, null, changed, owner.headers)).status, 409,
    'same request ID with any changed snapshot field conflicts')
  const fresh = servedImageSnapshot(uploaded.json, { snapshotId: RETRY_ID, capturedAt: '2026-10-04T12:04:00.000Z' })
  assert.equal((await refreshImage(owner.id, target.id, REQUEST_ID, fresh, owner.headers)).status, 409,
    'a fresh request cannot commit after the exact source grant is revoked')
  assert.equal(reads.length, 0)
})

test('initial served image admission requires current exact-path authority and an owned asset', async (t) => {
  const owner = await ownedSession()
  const ownAsset = await uploadImage(owner.tenant)
  assert.equal(ownAsset.status, 200)
  const target = attachment('cloud::photos/cover.png', { label: 'cover.png', kind: 'photo', previewText: undefined })
  const initialReceipt = servedImageSnapshot(ownAsset.json)
  const initial = await attach(owner.id, owner.headers, [{ ...target, imageSnapshot: initialReceipt }])
  assert.equal(initial.status, 200, 'an explicit picker capture may attach its already-uploaded owned asset')
  assert.deepEqual(initial.json.workspace.attachments[0].imageSnapshot, initialReceipt)

  const foreignAsset = await uploadImage('image-foreign-owner')
  assert.equal(foreignAsset.status, 200)
  const foreign = servedImageSnapshot(foreignAsset.json)
  const denied = await attach(owner.id, owner.headers, [{ ...target, imageSnapshot: foreign }])
  assert.equal(denied.status, 400, 'matching metadata cannot attach another tenant’s unowned image asset')
  assert.deepEqual(store.sessionWorkspace(owner.id)?.attachments[0]?.imageSnapshot, initialReceipt)

  const runnerId = 'runner-local'
  const currentRunner = store.registry.get(runnerId)
  assert.ok(currentRunner)
  const original = { id: runnerId, label: currentRunner.label, host: currentRunner.host, capabilities: structuredClone(currentRunner.capabilities) }
  t.after(() => { store.registry.register(original) })
  const source = { id: `runner:${runnerId}`, kind: 'runner' as const, label: currentRunner.label, runnerId }
  const path = 'insights-dashboard/photos/cover.png'
  const runnerTarget = attachment(`runner:${runnerId}::${path}`, { label: 'cover.png', kind: 'photo', source, previewText: undefined })
  const runnerReceipt = servedImageSnapshot(ownAsset.json, { sourceId: source.id, path })
  store.registry.register({
    id: runnerId, label: original.label, host: original.host,
    capabilities: [{ type: 'fs.read', scopes: ['~/projects/insights-dashboard/other.png'] }],
  })
  assert.equal((await attach(owner.id, owner.headers, [{ ...runnerTarget, imageSnapshot: runnerReceipt }])).status, 400,
    'a different runner path grant does not authorize initial image admission')
  assert.deepEqual(store.sessionWorkspace(owner.id)?.attachments[0]?.imageSnapshot, initialReceipt)
  store.registry.register({
    id: runnerId, label: original.label, host: original.host,
    capabilities: [{ type: 'fs.read', scopes: [`~/projects/${path}`] }],
  })
  assert.equal((await attach(owner.id, owner.headers, [{ ...runnerTarget, imageSnapshot: runnerReceipt }])).status, 200,
    'the exact current runner path grant permits initial image admission')
})

test('runner image Refresh checks the current exact fs.read path, then permits exact replay after revocation', async (t) => {
  const runnerId = 'runner-local'
  const currentRunner = store.registry.get(runnerId)
  assert.ok(currentRunner)
  const original = { id: runnerId, label: currentRunner.label, host: currentRunner.host, capabilities: structuredClone(currentRunner.capabilities) }
  t.after(() => { store.registry.register(original) })
  const source = { id: `runner:${runnerId}`, kind: 'runner' as const, label: currentRunner.label, runnerId }
  const owner = await ownedSession()
  const path = 'insights-dashboard/photos/cover.png'
  const id = `runner:${runnerId}::${path}`
  store.registry.register({
    id: runnerId, label: original.label, host: original.host,
    capabilities: [{ type: 'fs.read', scopes: ['~/projects/insights-dashboard/photos/cover.png'] }],
  })
  const target = attachment(id, { label: 'cover.png', kind: 'photo', source })
  assert.equal((await attach(owner.id, owner.headers, [target])).status, 200)
  const uploaded = await uploadImage(owner.tenant)
  const frozen = servedImageSnapshot(uploaded.json, { sourceId: source.id, path })
  assert.equal((await refreshImage(owner.id, id, null, frozen, owner.headers)).status, 200)

  store.registry.register({
    id: runnerId, label: original.label, host: original.host,
    capabilities: [{ type: 'fs.read', scopes: ['~/projects/insights-dashboard/other.png'] }],
  })
  const replay = await refreshImage(owner.id, id, null, frozen, owner.headers)
  assert.equal(replay.status, 200)
  assert.deepEqual(replay.json.workspace.attachments[0].imageSnapshot, frozen)
  const fresh = servedImageSnapshot(uploaded.json, { sourceId: source.id, path, snapshotId: RETRY_ID })
  assert.equal((await refreshImage(owner.id, id, REQUEST_ID, fresh, owner.headers)).status, 409,
    'a different path grant does not authorize fresh image Refresh')
})

test('runner document Refresh requires its current exact path grant even when another fs.read grant remains', async (t) => {
  const runnerId = 'runner-local'
  const currentRunner = store.registry.get(runnerId)
  assert.ok(currentRunner)
  const original = { id: runnerId, label: currentRunner.label, host: currentRunner.host, capabilities: structuredClone(currentRunner.capabilities) }
  t.after(() => { store.registry.register(original) })
  const source = { id: `runner:${runnerId}`, kind: 'runner' as const, label: currentRunner.label, runnerId }
  const owner = await ownedSession()
  store.registry.register({
    id: runnerId, label: original.label, host: original.host,
    capabilities: [{ type: 'fs.read', scopes: ['~/projects/insights-dashboard/brief.pdf'] }],
  })
  const pdfPath = 'insights-dashboard/brief.pdf'
  const pdfId = `runner:${runnerId}::${pdfPath}`
  assert.equal((await attach(owner.id, owner.headers, [attachment(pdfId, { label: 'brief.pdf', source })])).status, 200)
  const pdf = documentSnapshot({ sourceId: `runner:${runnerId}`, path: pdfPath })
  const initial = await refreshDocument(owner.id, pdfId, null, pdf, owner.headers)
  assert.equal(initial.status, 200)
  const reads = countSnapshotReads(t, () => { throw new Error('a v2 receipt replay must not read source content') })

  store.registry.register({
    id: runnerId, label: original.label, host: original.host,
    capabilities: [
      { type: 'fs.read', scopes: ['~/projects/insights-dashboard/other.pdf'] },
      { type: 'fs.read', scopes: ['~/projects/insights-dashboard/src-notes.md'] },
    ],
  })
  const revokedReplay = await refreshDocument(owner.id, pdfId, null, pdf, owner.headers)
  assert.equal(revokedReplay.status, 200, 'an acknowledged exact receipt remains recoverable after source permission is revoked')
  assert.deepEqual(store.sessionWorkspace(owner.id)?.attachments[0]?.textSnapshot, pdf)
  const changedSameKey = await refreshDocument(owner.id, pdfId, null, documentSnapshot({
    sourceId: `runner:${runnerId}`, path: pdfPath, text: 'different retry payload',
  }), owner.headers)
  assert.equal(changedSameKey.status, 409, 'a changed payload cannot reuse the receipt even after permission is revoked')
  const freshRequest = documentSnapshot({ snapshotId: RETRY_ID, sourceId: `runner:${runnerId}`, path: pdfPath })
  const freshRefusal = await refreshDocument(owner.id, pdfId, REQUEST_ID, freshRequest, owner.headers)
  assert.equal(freshRefusal.status, 409, 'revoked exact-path authority still blocks a new refresh')
  assert.equal(reads.length, 0, 'receipt replay and refused fresh intent perform no source content reads')
})

test('stale snapshots, detached references, malformed bodies, and read failures refuse without losing saved state', async (t) => {
  const owner = await ownedSession()
  const old = snapshot({ text: 'last known saved copy' })
  const target = attachment('cloud::notes.md', { textSnapshot: old })
  assert.equal((await attach(owner.id, owner.headers, [target])).status, 200)
  const before = structuredClone(store.sessionWorkspace(owner.id))
  const reads = countSnapshotReads(t, () => undefined)

  const stale = await refresh(owner.id, target.id, 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', REQUEST_ID, owner.headers)
  assert.equal(stale.status, 409)
  assert.deepEqual(store.sessionWorkspace(owner.id), before)
  assert.equal(reads.length, 0, 'stale expected id is checked before source I/O')

  const malformedBodies = [
    {},
    { expectedSnapshotId: 'not-a-uuid', requestId: REQUEST_ID },
    { expectedSnapshotId: old.snapshotId, requestId: old.snapshotId },
    { expectedSnapshotId: old.snapshotId, requestId: REQUEST_ID, extra: true },
  ]
  for (const body of malformedBodies) {
    const response = await call('POST', `/sessions/${owner.id}/attachments/${encodeURIComponent(target.id)}/refresh`, body, owner.headers)
    assert.equal(response.status, 400)
  }
  assert.equal(reads.length, 0, 'malformed requests do not read the source')

  const failedRead = await refresh(owner.id, target.id, old.snapshotId, RETRY_ID, owner.headers)
  assert.equal(failedRead.status, 400)
  assert.deepEqual(store.sessionWorkspace(owner.id), before, 'failed read leaves the old snapshot intact')
  assert.equal(reads.length, 1)

  const detachedId = 'cloud::detached.md'
  const detached = await refresh(owner.id, detachedId, null, 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', owner.headers)
  assert.equal(detached.status, 409)
  assert.equal(reads.length, 1, 'detached or unknown attachment refuses before source I/O')
})

test('legacy source-kind mismatches refuse refresh before reading the source', async (t) => {
  const owner = await ownedSession()
  const mismatched = attachment('cloud::notes.md', {
    source: { id: 'cloud', kind: 'runner', label: 'Misclassified cloud source' },
  })
  assert.equal((await attach(owner.id, owner.headers, [mismatched])).status, 200, 'legacy metadata can already exist')
  const before = structuredClone(store.sessionWorkspace(owner.id))
  const reads = countSnapshotReads(t, (_source, path, id) => snapshot({ path, snapshotId: id ?? REQUEST_ID }))

  const result = await refresh(owner.id, mismatched.id, null, REQUEST_ID, owner.headers)
  assert.equal(result.status, 409)
  assert.deepEqual(store.sessionWorkspace(owner.id), before, 'the invalid legacy row remains unchanged')
  assert.equal(reads.length, 0, 'source kind is checked before filesystem access')
})

test('view, comment, and propose grants cannot refresh; foreign sessions remain existence-hidden', async (t) => {
  const reads = countSnapshotReads(t, (_source, path, id) => snapshot({ path, snapshotId: id ?? FIRST_ID }))
  for (const tier of ['view', 'comment', 'propose'] as const) {
    const owner = await ownedSession()
    assert.equal((await attach(owner.id, owner.headers, [attachment()])).status, 200)
    const grant = store.createGrant({
      subject: { kind: 'session', id: owner.id },
      audience: { kind: 'org', orgId: 'tenant-beta' },
      tier,
    }, owner.tenant)
    assert.ok(grant && typeof grant === 'object')
    const readerHeaders = { 'x-tenant-id': 'tenant-beta' }
    const readable = await call('GET', `/sessions/${owner.id}`, undefined, readerHeaders)
    assert.equal(readable.status, 200)
    assert.equal(readable.json.own, false)
    const malformed = await call('POST', `/sessions/${owner.id}/attachments/cloud%3A%3Anotes.md/refresh`, {}, readerHeaders)
    assert.equal(malformed.status, 403, `${tier} ownership is checked before refresh body validation`)
    const oversized = await call('POST', `/sessions/${owner.id}/attachments/cloud%3A%3Anotes.md/refresh`, {
      note: 'x'.repeat(1024 * 1024 + 1),
    }, readerHeaders)
    assert.equal(oversized.status, 403, `${tier} ownership is checked before consuming a request body`)
    const denied = await refresh(owner.id, 'cloud::notes.md', null, REQUEST_ID, readerHeaders)
    assert.equal(denied.status, 403, `${tier} grant is not refresh authority`)
  }

  const foreignOwner = await ownedSession()
  assert.equal((await attach(foreignOwner.id, foreignOwner.headers, [attachment()])).status, 200)
  const foreign = await refresh(foreignOwner.id, 'cloud::notes.md', null, REQUEST_ID, { 'x-tenant-id': 'tenant-no-grant' })
  assert.equal(foreign.status, 404)
  assert.equal(reads.length, 0, 'unauthorized refresh attempts never reach the filesystem reader')
})

test('refresh rechecks ownership after awaiting the request body', async (t) => {
  const owner = await ownedSession()
  assert.equal((await attach(owner.id, owner.headers, [attachment()])).status, 200)
  const session = store.getSession(owner.id)
  assert.ok(session)
  const originalGetSession = store.getSession.bind(store)
  let lookups = 0
  t.mock.method(store, 'getSession', (id: string) => {
    const current = originalGetSession(id)
    if (id !== owner.id || !current) return current
    lookups += 1
    return lookups === 3 ? { ...current, tenantId: 'ownership-changed-during-body-read' } : current
  })
  const reads = countSnapshotReads(t, () => snapshot({ snapshotId: REQUEST_ID }))

  const result = await refresh(owner.id, 'cloud::notes.md', null, REQUEST_ID, owner.headers)
  assert.equal(result.status, 404, 'visibility/ownership is checked again after the body await')
  assert.equal(reads.length, 0, 'ownership loss before commit never reads the source')
})

test('document Refresh held across detach and reattach cannot adopt the new attachment or account', async (t) => {
  const owner = await ownedSession()
  const target = attachment('cloud::brief.pdf', { label: 'brief.pdf' })
  const headers = { ...owner.headers, 'x-account-transition-source': 'unsigned' }
  assert.equal((await attach(owner.id, headers, [target])).status, 200)
  const frozen = documentSnapshot()
  const pending = refreshWithHeldBody(owner.id, target.id, frozen, headers)
  await pending.waitingForBody

  assert.equal((await attach(owner.id, headers, [])).status, 200)
  assert.equal((await attach(owner.id, headers, [target])).status, 200)
  pending.release()
  const reincarnated = await pending.result()
  assert.equal(reincarnated.status, 409, 'a delayed body cannot adopt a detached and reattached workspace row')
  assert.equal(store.sessionWorkspace(owner.id)?.attachments[0]?.textSnapshot, undefined)

  const accountHeaders = { ...owner.headers, 'x-account-transition-source': 'session:served-document-user' }
  let accountChanged = false
  const originalIdentity = store.identity.bind(store)
  t.mock.method(store, 'identity', (input: Record<string, string | string[] | undefined>) => {
    const identity = originalIdentity(input)
    if (input === accountHeaders) {
      return { ...identity, via: 'session', user: { ...identity.user, id: accountChanged ? 'different-user' : 'served-document-user' } }
    }
    return identity
  })
  const pendingAccount = refreshWithHeldBody(owner.id, target.id, frozen, accountHeaders)
  await pendingAccount.waitingForBody
  accountChanged = true

  pendingAccount.release()
  const result = await pendingAccount.result()
  assert.equal(result.status, 409, 'the post-body account source check runs before attachment mutation')
  assert.equal(store.sessionWorkspace(owner.id)?.attachments[0]?.textSnapshot, undefined)
})

test('context-state rejects malformed initial snapshot attachments atomically', async () => {
  const owner = await ownedSession()
  const badSnapshots = [
    { ...snapshot(), sourceId: 'runner:elsewhere' },
    { ...snapshot(), path: '../outside.md' },
    { ...snapshot(), extra: 'unrecognized field' },
  ]
  for (const textSnapshot of badSnapshots) {
    const result = await attach(owner.id, owner.headers, [attachment('cloud::notes.md', { textSnapshot })])
    assert.equal(result.status, 400)
    assert.deepEqual(store.sessionWorkspace(owner.id), EMPTY)
  }
})
