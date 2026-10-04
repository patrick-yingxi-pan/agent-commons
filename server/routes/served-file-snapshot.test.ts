/** Served-file snapshots are explicit saved copies: intake and Refresh are the
 * only read doors, and refreshing a session attachment is owner-only. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from '../store/index.ts'
import { call, callFresh } from '../testkit/http.ts'
import type { ServedTextSnapshot } from '../../contract/servedTextSnapshot.ts'

const SOURCE = { id: 'cloud', kind: 'cloud' as const, label: 'Cloud storage' }
const EMPTY = { workspaces: [], repos: [], connectors: [], attachments: [] }
const FIRST_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const REQUEST_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const RETRY_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
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
