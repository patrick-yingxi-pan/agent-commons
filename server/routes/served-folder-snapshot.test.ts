/** Saved folder snapshots are explicit copies attached to a Session workspace. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from '../store/index.ts'
import { call, callFresh } from '../testkit/http.ts'
import type { ServedFolderSnapshot } from '../../contract/servedFolderSnapshot.ts'

const SOURCE = { id: 'cloud', kind: 'cloud' as const, label: 'Cloud storage' }
const EMPTY = { workspaces: [], repos: [], connectors: [], attachments: [] }
const FIRST_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const REQUEST_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const RETRY_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
let sequence = 0

function snapshot(overrides: Partial<ServedFolderSnapshot> = {}): ServedFolderSnapshot {
  return {
    version: 1,
    snapshotId: FIRST_ID,
    capturedAt: '2026-10-04T12:00:00.000Z',
    sourceId: 'cloud',
    path: 'research',
    files: [{ name: 'notes.md', sizeBytes: 15, snapshot: { text: 'captured folder' } }],
    ...overrides,
  }
}

async function ownedSession() {
  const tenant = `folder-snapshot-owner-${++sequence}`
  const session = store.createSession(`served folder snapshot ${sequence}`, tenant)
  return { id: session.id, tenant, headers: { 'x-tenant-id': tenant } }
}

function folder(id = 'cloud::research', value?: ServedFolderSnapshot) {
  return { id, label: id.split('::').at(-1)!, ...(value ? { snapshot: value } : {}) }
}

function workspace(folders: ReturnType<typeof folder>[], artifacts: unknown[] = []) {
  return {
    ...EMPTY,
    workspaces: [{ id: 'workspace-main', label: 'Workspace', artifacts, folders }],
  }
}

async function attachFolder(
  sid: string,
  headers: Record<string, string>,
  folders: ReturnType<typeof folder>[],
  contextId = 'cloud::research',
  path = 'research',
  source = SOURCE,
) {
  return call('PATCH', `/sessions/${sid}/context-state`, {
    operations: folders.map((item, index) => {
      const [itemSource, ...itemPath] = item.id.split('::')
      return {
        action: 'attach',
        context: {
          id: index === 0 ? contextId : item.id,
          type: 'folder',
          label: item.label,
          scope: index === 0 ? path : itemPath.join('::'),
          source: index === 0 ? source : { id: itemSource, kind: itemSource === 'cloud' ? 'cloud' : 'runner', label: itemSource === 'cloud' ? 'Cloud storage' : itemSource },
        },
      }
    }),
    workspace: workspace(folders, [{ id: 'authored', name: 'authored.md', kind: 'doc', meta: 'keep' }]),
  }, headers)
}

function refresh(sid: string, folderId: string, expectedSnapshotId: string | null, requestId: string, headers: Record<string, string>) {
  return call('POST', `/sessions/${sid}/folders/${encodeURIComponent(folderId)}/refresh`, { expectedSnapshotId, requestId }, headers)
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

test('GET folder snapshot captures a populated served folder', async () => {
  const response = await call('GET', '/fs/folder-snapshot?source=cloud&path=insights-dashboard')
  assert.equal(response.status, 200)
  assert.equal(response.json.sourceId, 'cloud')
  assert.equal(response.json.path, 'insights-dashboard')
  assert.ok(Array.isArray(response.json.files))
  assert.equal(response.json.files.some((file: any) => file.name === 'readme.md' && typeof file.snapshot.text === 'string'), true)
})

test('folder intake requires an exact explicit scope; unknown and duplicate scopes never read', async (t) => {
  const calls: unknown[][] = []
  t.mock.method(store, 'fsFolderSnapshot', (...args: unknown[]) => {
    calls.push(args)
    return snapshot()
  })
  for (const query of ['scope=tree', 'scope=', 'scope=recursive&scope=flat', 'scope=recursive&scope=recursive']) {
    assert.equal((await call('GET', `/fs/folder-snapshot?source=cloud&path=research&${query}`)).status, 400)
  }
  assert.deepEqual(calls, [])
  assert.equal((await call('GET', '/fs/folder-snapshot?source=cloud&path=research&scope=recursive')).status, 200)
  assert.deepEqual(calls, [['cloud', 'research', undefined, 'recursive']])
})

test('recursive Refresh retains its saved scope and exact keyed replay, refusing a downgraded response', async (t) => {
  const owner = await ownedSession()
  const prior = snapshot({ version: 2, scope: 'recursive', files: [
    { name: 'nested/notes.md', sizeBytes: 3, snapshot: { text: 'old' } },
  ] })
  assert.equal((await attachFolder(owner.id, owner.headers, [folder('cloud::research', prior)])).status, 200)
  const reads: unknown[][] = []
  let downgrade = true
  t.mock.method(store, 'fsFolderSnapshot', (...args: unknown[]) => {
    reads.push(args)
    return downgrade ? snapshot({ snapshotId: REQUEST_ID }) : { ...prior, snapshotId: REQUEST_ID }
  })
  assert.equal((await refresh(owner.id, 'cloud::research', FIRST_ID, REQUEST_ID, owner.headers)).status, 400)
  assert.deepEqual(store.sessionWorkspace(owner.id)?.workspaces[0].folders?.[0].snapshot, prior)
  downgrade = false
  const result = await refresh(owner.id, 'cloud::research', FIRST_ID, REQUEST_ID, owner.headers)
  assert.equal(result.status, 200)
  assert.deepEqual(result.json.workspace.workspaces[0].folders[0].snapshot, { ...prior, snapshotId: REQUEST_ID })
  assert.deepEqual(reads, Array(2).fill(['cloud', 'research', REQUEST_ID, 'recursive']))
  const replay = await refresh(owner.id, 'cloud::research', FIRST_ID, REQUEST_ID, owner.headers)
  assert.equal(replay.status, 200)
  assert.deepEqual(replay.json, result.json)
  assert.equal(reads.length, 2)
})

test('GET folder snapshot returns a successful empty capture for an empty folder', async (t) => {
  t.mock.method(store, 'fsFolderSnapshot', () => snapshot({ path: 'empty', files: [] }))
  const response = await call('GET', '/fs/folder-snapshot?source=cloud&path=empty')
  assert.equal(response.status, 200)
  assert.deepEqual(response.json, snapshot({ path: 'empty', files: [] }))
})

test('folder Refresh updates one explicit snapshot and retains sibling folders, authored artifacts and bindings', async (t) => {
  const owner = await ownedSession()
  const reads: Array<[string, string, string | undefined]> = []
  t.mock.method(store, 'fsFolderSnapshot', (sourceId: string, path: string, snapshotId?: string) => {
    reads.push([sourceId, path, snapshotId])
    const text = snapshotId ? 'refreshed folder' : 'captured folder'
    return snapshot({ path, snapshotId: snapshotId ?? FIRST_ID, files: [{ name: 'notes.md', sizeBytes: Buffer.byteLength(text), snapshot: { text } }] })
  })
  const intake = await call('GET', '/fs/folder-snapshot?source=cloud&path=research', undefined, owner.headers)
  assert.equal(intake.status, 200)
  assert.deepEqual(intake.json, snapshot())

  const initial = await attachFolder(owner.id, owner.headers, [folder('cloud::research', intake.json), folder('cloud::other', snapshot({ path: 'other', snapshotId: RETRY_ID }))])
  assert.equal(initial.status, 200)
  const before = structuredClone(initial.json)
  const result = await refresh(owner.id, 'cloud::research', FIRST_ID, REQUEST_ID, owner.headers)
  assert.equal(result.status, 200)
  assert.deepEqual(result.json.contexts, before.contexts)
  assert.deepEqual(result.json.workspace.workspaces[0].folders[0].snapshot, snapshot({
    snapshotId: REQUEST_ID,
    files: [{ name: 'notes.md', sizeBytes: 16, snapshot: { text: 'refreshed folder' } }],
  }))
  assert.deepEqual(result.json.workspace.workspaces[0].folders[1], before.workspace.workspaces[0].folders[1])
  assert.deepEqual(result.json.workspace.workspaces[0].artifacts, before.workspace.workspaces[0].artifacts)
  assert.deepEqual(reads, [['cloud', 'research', undefined], ['cloud', 'research', REQUEST_ID]])

  const staleView = await call('PATCH', `/sessions/${owner.id}/context-state`, {
    operations: [], workspace: before.workspace,
  }, owner.headers)
  assert.equal(staleView.status, 200)
  assert.equal(staleView.json.workspace.workspaces[0].folders[0].snapshot.snapshotId, REQUEST_ID,
    'ordinary stale context state cannot rewind the refreshed folder receipt')

  const replay = await callFresh('POST', `/sessions/${owner.id}/folders/cloud%3A%3Aresearch/refresh`, {
    expectedSnapshotId: FIRST_ID, requestId: REQUEST_ID,
  }, owner.headers)
  assert.equal(replay.status, 200)
  assert.deepEqual(replay.json, result.json)
  assert.equal(reads.length, 2, 'exact keyed replay never rereads the source')
})

test('stale, malformed, detached and unreadable refreshes preserve the saved folder snapshot', async (t) => {
  const owner = await ownedSession()
  const prior = snapshot({ files: [{ name: 'old.md', sizeBytes: 3, snapshot: { text: 'old' } }] })
  assert.equal((await attachFolder(owner.id, owner.headers, [folder('cloud::research', prior)])).status, 200)
  const before = structuredClone(store.sessionWorkspace(owner.id))
  const reads: unknown[][] = []
  t.mock.method(store, 'fsFolderSnapshot', (...args: [string, string, string?]) => { reads.push(args); return undefined })

  const stale = await refresh(owner.id, 'cloud::research', RETRY_ID, REQUEST_ID, owner.headers)
  assert.equal(stale.status, 409)
  assert.equal(reads.length, 0, 'stale compare-and-swap refuses before I/O')
  for (const body of [
    {},
    { expectedSnapshotId: 'bad', requestId: REQUEST_ID },
    { expectedSnapshotId: prior.snapshotId, requestId: prior.snapshotId },
    { expectedSnapshotId: prior.snapshotId, requestId: REQUEST_ID, extra: true },
    { expectedSnapshotId: null, requestId: REQUEST_ID, imageSnapshot: {
      version: 1, snapshotId: REQUEST_ID, capturedAt: '2026-10-04T12:00:00.000Z', sourceId: 'cloud', path: 'photos/cover.png',
      image: { id: `img-${'a'.repeat(64)}`, mimeType: 'image/png', width: 1, height: 1, byteLength: 68 },
    } },
  ]) {
    assert.equal((await call('POST', `/sessions/${owner.id}/folders/cloud%3A%3Aresearch/refresh`, body, owner.headers)).status, 400)
  }
  assert.equal(reads.length, 0, 'malformed requests do not touch the source')

  const failed = await refresh(owner.id, 'cloud::research', FIRST_ID, REQUEST_ID, owner.headers)
  assert.equal(failed.status, 400)
  assert.deepEqual(store.sessionWorkspace(owner.id), before)
  assert.equal(reads.length, 1)

  const detachedWorkspace = workspace([])
  assert.equal((await call('PATCH', `/sessions/${owner.id}/context-state`, { operations: [{ action: 'detach', contextId: 'cloud::research' }], workspace: detachedWorkspace }, owner.headers)).status, 200)
  assert.equal((await refresh(owner.id, 'cloud::research', null, RETRY_ID, owner.headers)).status, 409)
  assert.equal(reads.length, 1, 'detached folders refuse before source I/O')
})

test('mismatched snapshots are rejected on intake and mismatched source bindings cannot refresh', async (t) => {
  const owner = await ownedSession()
  const mismatched = snapshot({ path: 'somewhere-else' })
  const attached = await attachFolder(owner.id, owner.headers, [folder('cloud::research', mismatched)])
  assert.equal(attached.status, 400, 'a closed snapshot must match its explicit folder identity')
  const reads: unknown[][] = []
  t.mock.method(store, 'fsFolderSnapshot', (...args: [string, string, string?]) => { reads.push(args); return snapshot() })
  assert.equal((await attachFolder(owner.id, owner.headers, [folder('cloud::research', snapshot())], 'cloud::research', 'somewhere-else')).status, 200)
  const refused = await refresh(owner.id, 'cloud::research', FIRST_ID, REQUEST_ID, owner.headers)
  assert.equal(refused.status, 409)
  assert.equal(reads.length, 0, 'binding mismatch is rejected before filesystem access')
})

test('duplicate legacy folder identities are refused before canonical workspace changes', async () => {
  const owner = await ownedSession()
  const before = structuredClone(store.sessionWorkspace(owner.id))
  const source = { id: 'cloud::research', label: 'research' }
  const legacy = { id: 'first', label: 'First', artifacts: [{ id: 'notes', name: 'notes.md', kind: 'doc', meta: '', source }] }
  for (const duplicate of [
    { ...legacy, id: 'second' },
    { id: 'second', label: 'Second', artifacts: [], folders: [source] },
  ]) {
    const result = await call('PATCH', `/sessions/${owner.id}/context-state`, {
      operations: [], workspace: { ...EMPTY, workspaces: [legacy, duplicate] },
    }, owner.headers)
    assert.equal(result.status, 400)
    assert.deepEqual(store.sessionWorkspace(owner.id), before)
  }
})

test('refresh rechecks owner identity after source capture yields', async (t) => {
  const owner = await ownedSession()
  assert.equal((await attachFolder(owner.id, owner.headers, [folder()])).status, 200)
  const started = deferred<void>()
  const captured = deferred<ServedFolderSnapshot | undefined>()
  t.mock.method(store, 'fsFolderSnapshot', () => {
    started.resolve()
    return captured.promise
  })
  const originalGetSession = store.getSession.bind(store)
  let ownerChanged = false
  t.mock.method(store, 'getSession', (id: string) => {
    const current = originalGetSession(id)
    return id === owner.id && current && ownerChanged ? { ...current, tenantId: 'tenant-beta' } : current
  })

  const pending = refresh(owner.id, 'cloud::research', null, REQUEST_ID, owner.headers)
  await started.promise
  ownerChanged = true
  captured.resolve(snapshot({ snapshotId: REQUEST_ID }))
  const result = await pending
  assert.equal(result.status, 404)
  assert.equal(store.sessionWorkspace(owner.id)?.workspaces[0]?.folders?.[0]?.snapshot, undefined,
    'lost ownership cannot commit a completed capture')
})

test('refresh refuses a target detached and reattached under the same id during capture', async (t) => {
  const owner = await ownedSession()
  assert.equal((await attachFolder(owner.id, owner.headers, [folder()])).status, 200)
  const started = deferred<void>()
  const captured = deferred<ServedFolderSnapshot | undefined>()
  t.mock.method(store, 'fsFolderSnapshot', () => {
    started.resolve()
    return captured.promise
  })
  const pending = refresh(owner.id, 'cloud::research', null, REQUEST_ID, owner.headers)
  await started.promise

  assert.equal((await call('PATCH', `/sessions/${owner.id}/context-state`, {
    operations: [{ action: 'detach', contextId: 'cloud::research' }], workspace: workspace([]),
  }, owner.headers)).status, 200)
  assert.equal((await attachFolder(owner.id, owner.headers, [folder()])).status, 200)

  captured.resolve(snapshot({ snapshotId: REQUEST_ID }))
  const result = await pending
  assert.equal(result.status, 409)
  assert.equal(store.sessionWorkspace(owner.id)?.workspaces[0]?.folders?.[0]?.snapshot, undefined,
    'a later attachment with the same id is not the originally captured binding')
})

test('refresh retains unrelated folder and context edits made while capture is in flight', async (t) => {
  const owner = await ownedSession()
  assert.equal((await attachFolder(owner.id, owner.headers, [folder()])).status, 200)
  const started = deferred<void>()
  const captured = deferred<ServedFolderSnapshot | undefined>()
  t.mock.method(store, 'fsFolderSnapshot', () => {
    started.resolve()
    return captured.promise
  })
  const pending = refresh(owner.id, 'cloud::research', null, REQUEST_ID, owner.headers)
  await started.promise

  const current = structuredClone(store.sessionWorkspace(owner.id)!)
  current.workspaces[0].folders?.push(folder('cloud::other'))
  current.workspaces[0].artifacts.push({ id: 'new-authored', name: 'new.md', kind: 'doc', meta: 'new' })
  const edited = await call('PATCH', `/sessions/${owner.id}/context-state`, {
    operations: [{ action: 'attach', context: { id: 'cloud::other', type: 'folder', label: 'other', scope: 'other', source: SOURCE } }],
    workspace: current,
  }, owner.headers)
  assert.equal(edited.status, 200)

  captured.resolve(snapshot({ snapshotId: REQUEST_ID }))
  const result = await pending
  assert.equal(result.status, 200)
  assert.equal(result.json.workspace.workspaces[0].folders[0].snapshot.snapshotId, REQUEST_ID)
  assert.equal(result.json.workspace.workspaces[0].folders[1].id, 'cloud::other')
  assert.equal(result.json.workspace.workspaces[0].artifacts.some((item: any) => item.id === 'new-authored'), true)
  assert.equal(result.json.contexts.some((context: any) => context.id === 'cloud::other'), true)
})

test('runner registry replacement with a narrowed grant refuses a capture completed under old authority', async (t) => {
  const runnerId = 'runner-local'
  const currentRunner = store.registry.get(runnerId)
  assert.ok(currentRunner)
  const original = {
    id: runnerId,
    label: currentRunner.label,
    host: currentRunner.host,
    capabilities: structuredClone(currentRunner.capabilities),
  }
  t.after(() => { store.registry.register(original) })
  const path = 'insights-dashboard'
  const folderId = 'runner:runner-local::insights-dashboard'
  const source = { id: 'runner:runner-local', kind: 'runner' as const, label: currentRunner.label, runnerId }
  const owner = await ownedSession()
  store.registry.setCapabilities(runnerId, [
    { type: 'fs.list', scopes: ['~/projects'] },
    { type: 'fs.read', scopes: ['~/projects'] },
  ])
  assert.equal((await attachFolder(owner.id, owner.headers, [folder(folderId)], folderId, path, source)).status, 200)

  const started = deferred<void>()
  const captured = deferred<ServedFolderSnapshot | undefined>()
  t.mock.method(store, 'fsFolderSnapshot', () => {
    started.resolve()
    return captured.promise
  })
  const pending = refresh(owner.id, folderId, null, REQUEST_ID, owner.headers)
  await started.promise
  // Replace the registry's Runner object and retain only different in-binding
  // file grants. Global fs.read/fs.list still exist, but not for captured names.
  store.registry.register({
    id: runnerId,
    label: original.label,
    host: original.host,
    capabilities: [
      { type: 'fs.list', scopes: [`~/projects/${path}/other.md`] },
      { type: 'fs.read', scopes: [`~/projects/${path}/other.md`] },
    ],
  })
  captured.resolve(snapshot({
    sourceId: 'runner:runner-local', path, snapshotId: REQUEST_ID,
    files: [{ name: 'src-notes.md', sizeBytes: 8, snapshot: { text: 'captured' } }],
  }))
  const result = await pending
  assert.equal(result.status, 400)
  assert.equal(store.sessionWorkspace(owner.id)?.workspaces[0]?.folders?.[0]?.snapshot, undefined,
    'a capture cannot commit bytes after the current runner no longer grants those entries')
})

test('Refresh is owner-only for shared and foreign sessions; initial null snapshots and empty captures are valid', async (t) => {
  const owner = await ownedSession()
  const reads: unknown[][] = []
  t.mock.method(store, 'fsFolderSnapshot', (...args: [string, string, string?]) => {
    reads.push(args)
    return snapshot({ snapshotId: args[2] ?? FIRST_ID, files: [] })
  })
  assert.equal((await attachFolder(owner.id, owner.headers, [folder()])).status, 200)
  const nullSave = await refresh(owner.id, 'cloud::research', null, REQUEST_ID, owner.headers)
  assert.equal(nullSave.status, 200)
  assert.deepEqual(nullSave.json.workspace.workspaces[0].folders[0].snapshot.files, [])

  const grant = store.createGrant({ subject: { kind: 'session', id: owner.id }, audience: { kind: 'org', orgId: 'tenant-beta' }, tier: 'view' }, owner.tenant)
  assert.ok(grant && typeof grant === 'object')
  const sharedHeaders = { 'x-tenant-id': 'tenant-beta' }
  assert.equal((await call('GET', `/sessions/${owner.id}`, undefined, sharedHeaders)).status, 200)
  assert.equal((await refresh(owner.id, 'cloud::research', REQUEST_ID, RETRY_ID, sharedHeaders)).status, 403)
  assert.equal((await refresh(owner.id, 'cloud::research', null, RETRY_ID, { 'x-tenant-id': 'tenant-no-grant' })).status, 404)
  assert.equal(reads.length, 1, 'non-owners cannot reach the source')
})
