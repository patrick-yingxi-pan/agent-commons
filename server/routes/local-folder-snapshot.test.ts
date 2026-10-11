/** Owner-walled Refresh of frozen native local-folder bytes. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from '../store/index.ts'
import { buildRouter } from './index.ts'
import { call, callFresh } from '../testkit/http.ts'
import type { LocalFolderCapture } from '../../contract/localFolderCapture.ts'
import { fsRecentKey } from '../../contract/fs.ts'

const EMPTY = { workspaces: [], repos: [], connectors: [], attachments: [] }
const FIRST_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const REQUEST_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const CHANGED_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const CONNECTION = 'LOCAL_0123456789ABCDEF0123456789ABCDEF'
const CONNECTION_2 = 'LOCAL_1123456789ABCDEF0123456789ABCDEF'
let sequence = 0

function capture(overrides: Partial<LocalFolderCapture> = {}): LocalFolderCapture {
  return {
    version: 1,
    snapshotId: REQUEST_ID,
    capturedAt: '2026-10-04T12:00:00.000Z',
    connectionId: CONNECTION,
    files: [{ name: 'notes.md', sizeBytes: 15, snapshot: { text: 'captured folder' } }],
    ...overrides,
  }
}

async function ownedSession() {
  const tenant = `local-folder-owner-${++sequence}`
  const session = store.createSession(`local folder snapshot ${sequence}`, tenant)
  return { id: session.id, tenant, headers: { 'x-tenant-id': tenant, 'x-account-transition-source': 'unsigned' } }
}

function folder(connectionId: string, localSnapshot?: LocalFolderCapture) {
  const id = fsRecentKey('ui-host', connectionId)
  return { id, label: `Local ${connectionId.slice(-4)}`, ...(localSnapshot ? { localSnapshot } : {}) }
}

function workspace(folders: ReturnType<typeof folder>[]) {
  return { ...EMPTY, workspaces: [{ id: 'workspace-main', label: 'Workspace', artifacts: [], folders }] }
}

async function attach(owner: Awaited<ReturnType<typeof ownedSession>>, connectionIds: string[], headers = owner.headers) {
  const folders = connectionIds.map((connectionId) => folder(connectionId))
  return call('PATCH', `/sessions/${owner.id}/context-state`, {
    operations: connectionIds.map((connectionId, index) => ({
      action: 'attach',
      context: {
        id: fsRecentKey('ui-host', connectionId), type: 'folder', label: folders[index]!.label,
        scope: connectionId, source: { id: 'ui-host', kind: 'ui-host', label: 'This computer' },
      },
    })),
    workspace: workspace(folders),
  }, headers)
}

function refresh(owner: Awaited<ReturnType<typeof ownedSession>>, connectionId: string, expectedSnapshotId: string | null, snapshot: LocalFolderCapture, headers = owner.headers) {
  return call('POST', `/sessions/${owner.id}/local-folders/${encodeURIComponent(fsRecentKey('ui-host', connectionId))}/refresh`, {
    expectedSnapshotId, requestId: snapshot.snapshotId, snapshot,
  }, headers)
}

function refreshWithHeldBody(owner: Awaited<ReturnType<typeof ownedSession>>, snapshot: LocalFolderCapture) {
  const router = buildRouter()
  const path = `/sessions/${owner.id}/local-folders/${encodeURIComponent(fsRecentKey('ui-host', CONNECTION))}/refresh`
  let dataHandler: ((chunk: Uint8Array) => void) | undefined
  let endHandler: (() => void) | undefined
  let bodyRequested!: () => void
  const waitingForBody = new Promise<void>((resolve) => { bodyRequested = resolve })
  let status = 0
  let responseBody = ''
  const req: any = {
    method: 'POST',
    headers: owner.headers,
    on(event: string, handler: (chunk?: Uint8Array) => void) {
      if (event === 'data') dataHandler = handler as (chunk: Uint8Array) => void
      if (event === 'end') {
        endHandler = handler as () => void
        bodyRequested()
      }
      return req
    },
  }
  const res: any = {
    writeHead(code: number) { status = code; return res },
    setHeader() {},
    write(chunk: string) { responseBody += chunk; return true },
    end(chunk?: string) { if (chunk) responseBody += chunk },
    flushHeaders() {},
    on() {},
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

test('local Refresh commits frozen bytes to one attached folder, persists them, and refuses stale workspace rewind', async () => {
  const owner = await ownedSession()
  const initial = await attach(owner, [CONNECTION, CONNECTION_2])
  assert.equal(initial.status, 200)
  const before = structuredClone(initial.json)
  const first = capture()
  const result = await refresh(owner, CONNECTION, null, first)
  assert.equal(result.status, 200)
  assert.deepEqual(result.json.contexts, before.contexts)
  assert.deepEqual(result.json.workspace.workspaces[0].folders[0].localSnapshot, first)
  assert.deepEqual(result.json.workspace.workspaces[0].folders[1], before.workspace.workspaces[0].folders[1])
  assert.deepEqual(result.json.workspace.workspaces[0].artifacts, [])
  assert.deepEqual(store.sessionWorkspace(owner.id), result.json.workspace,
    'the session workspace stores the saved copy rather than a live source reference')

  const stale = await call('PATCH', `/sessions/${owner.id}/context-state`, { operations: [], workspace: before.workspace }, owner.headers)
  assert.equal(stale.status, 200)
  assert.deepEqual(stale.json.workspace, result.json.workspace, 'generic stale context state cannot rewind the saved capture')

  const replay = await callFresh('POST', `/sessions/${owner.id}/local-folders/${encodeURIComponent(fsRecentKey('ui-host', CONNECTION))}/refresh`, {
    expectedSnapshotId: null, requestId: first.snapshotId, snapshot: first,
  }, owner.headers)
  assert.equal(replay.status, 200)
  assert.deepEqual(replay.json.workspace, result.json.workspace)
  const changed = await refresh(owner, CONNECTION, null, capture({ files: [{ name: 'notes.md', sizeBytes: 7, snapshot: { text: 'changed' } }] }))
  assert.equal(changed.status, 409, 'a receipt key cannot be replayed with different bytes')
})

test('local Refresh is CAS guarded, requires an attached UI-host binding, and cannot be revived after detach', async () => {
  const owner = await ownedSession()
  assert.equal((await refresh(owner, CONNECTION, null, capture())).status, 409, 'route cannot create a folder or binding')
  assert.equal((await attach(owner, [CONNECTION])).status, 200)
  assert.equal((await refresh(owner, CONNECTION, FIRST_ID, capture())).status, 409, 'stale expected receipt refuses')
  assert.equal((await refresh(owner, CONNECTION, null, capture({ connectionId: CONNECTION_2 }))).status, 409, 'target id must match the captured connection')

  const detached = await call('PATCH', `/sessions/${owner.id}/context-state`, {
    operations: [{ action: 'detach', contextId: fsRecentKey('ui-host', CONNECTION) }], workspace: workspace([]),
  }, owner.headers)
  assert.equal(detached.status, 200)
  assert.equal((await refresh(owner, CONNECTION, null, capture())).status, 409)
})

test('local Refresh refuses a body held across detach and reattach of the same connection', async () => {
  const owner = await ownedSession()
  assert.equal((await attach(owner, [CONNECTION])).status, 200)
  const snapshot = capture()
  const pending = refreshWithHeldBody(owner, snapshot)
  await pending.waitingForBody

  const detached = await call('PATCH', `/sessions/${owner.id}/context-state`, {
    operations: [{ action: 'detach', contextId: fsRecentKey('ui-host', CONNECTION) }],
    workspace: workspace([]),
  }, owner.headers)
  assert.equal(detached.status, 200)
  const reattached = await attach(owner, [CONNECTION])
  assert.equal(reattached.status, 200)

  pending.release()
  const result = await pending.result()
  assert.equal(result.status, 409, 'an in-flight request cannot adopt a reincarnated binding')
  assert.equal(store.sessionWorkspace(owner.id)?.workspaces[0]?.folders?.[0]?.localSnapshot, undefined)
})

test('local Refresh fences stale account source and foreign owner without changing saved bytes', async () => {
  const owner = await ownedSession()
  assert.equal((await attach(owner, [CONNECTION])).status, 200)
  const staleSource = { ...owner.headers, 'x-account-transition-source': 'session:stale-user' }
  const wrongSource = await refresh(owner, CONNECTION, null, capture(), staleSource)
  assert.equal(wrongSource.status, 409)
  assert.equal(store.sessionWorkspace(owner.id)?.workspaces[0]?.folders?.[0]?.localSnapshot, undefined)

  const foreign = { 'x-tenant-id': `local-folder-foreign-${++sequence}`, 'x-account-transition-source': 'unsigned' }
  const denied = await refresh(owner, CONNECTION, null, capture(), foreign)
  assert.equal(denied.status, 404, 'foreign sessions remain existence-hidden')
  assert.equal(store.sessionWorkspace(owner.id)?.workspaces[0]?.folders?.[0]?.localSnapshot, undefined)
})

test('local Refresh accepts an empty capture and preserves it as a durable receipt', async () => {
  const owner = await ownedSession()
  assert.equal((await attach(owner, [CONNECTION])).status, 200)
  const empty = capture({ files: [] })
  const result = await refresh(owner, CONNECTION, null, empty)
  assert.equal(result.status, 200)
  assert.deepEqual(result.json.workspace.workspaces[0].folders[0].localSnapshot.files, [])
  assert.deepEqual((await refresh(owner, CONNECTION, null, empty)).json.workspace, result.json.workspace)
})

test('local Refresh preserves the attached snapshot scope across replacements', async () => {
  const owner = await ownedSession()
  assert.equal((await attach(owner, [CONNECTION])).status, 200)
  const recursive = capture({
    version: 2,
    scope: 'recursive',
    files: [
      { name: 'src/notes.md', sizeBytes: 5, snapshot: { text: 'first' } },
      { name: 'tests/notes.md', sizeBytes: 6, snapshot: { text: 'second' } },
    ],
  })
  const first = await refresh(owner, CONNECTION, null, recursive)
  assert.equal(first.status, 200)
  assert.deepEqual(first.json.workspace.workspaces[0].folders[0].localSnapshot, recursive)

  const flat = capture({ snapshotId: CHANGED_ID })
  const scopeChange = await refresh(owner, CONNECTION, recursive.snapshotId, flat)
  assert.equal(scopeChange.status, 409, 'Refresh cannot change recursive scope back to flat')
  assert.deepEqual(store.sessionWorkspace(owner.id), first.json.workspace, 'a refused scope change preserves exact saved paths')

  const flatOwner = await ownedSession()
  assert.equal((await attach(flatOwner, [CONNECTION])).status, 200)
  const initialFlat = capture({ snapshotId: FIRST_ID })
  assert.equal((await refresh(flatOwner, CONNECTION, null, initialFlat)).status, 200)
  const promote = capture({ version: 2, scope: 'recursive', snapshotId: CHANGED_ID,
    files: [{ name: 'src/notes.md', sizeBytes: 5, snapshot: { text: 'first' } }] })
  assert.equal((await refresh(flatOwner, CONNECTION, FIRST_ID, promote)).status, 409,
    'Refresh cannot change the original flat scope into recursive')
})

test('recursive Refresh remains owner-only and refuses malformed v2 captures', async () => {
  const owner = await ownedSession()
  assert.equal((await attach(owner, [CONNECTION])).status, 200)
  const grant = store.createGrant({
    subject: { kind: 'session', id: owner.id },
    audience: { kind: 'org', orgId: 'tenant-beta' },
    tier: 'view',
  }, owner.tenant)
  assert.ok(grant && typeof grant === 'object')
  const recursive = capture({
    version: 2,
    scope: 'recursive',
    files: [{ name: 'src/notes.md', sizeBytes: 4, snapshot: { text: 'body' } }],
  })
  const reader = { 'x-tenant-id': 'tenant-beta', 'x-account-transition-source': 'unsigned' }
  assert.equal((await refresh(owner, CONNECTION, null, recursive, reader)).status, 403)

  const malformed = { ...recursive, files: [{ ...recursive.files[0]!, name: 'src/../secret.md' }] } as LocalFolderCapture
  assert.equal((await refresh(owner, CONNECTION, null, malformed)).status, 400)
  const foreign = {
    'x-tenant-id': `${owner.tenant}-foreign`,
    'x-account-transition-source': 'unsigned',
  }
  assert.equal((await refresh(owner, CONNECTION, null, recursive, foreign)).status, 404)
  assert.equal(store.sessionWorkspace(owner.id)?.workspaces[0]?.folders?.[0]?.localSnapshot, undefined)
})

test('first-party source precondition fences stale local capture from draft creation and context attachment', async () => {
  const owner = await ownedSession()
  const staleSourceHeaders = { ...owner.headers, 'x-account-transition-source': 'session:previous-account' }
  const matchingDraftsBefore = store.listSessions(owner.tenant).filter((session) => session.title === 'captured local folder').length
  const created = await call('POST', '/sessions', { firstMessage: 'captured local folder' }, staleSourceHeaders)
  assert.equal(created.status, 409)
  assert.equal(store.listSessions(owner.tenant).filter((session) => session.title === 'captured local folder').length, matchingDraftsBefore,
    'stale account context cannot materialize a draft')
  assert.equal((await attach(owner, [CONNECTION], staleSourceHeaders)).status, 409)
  assert.deepEqual(store.sessionContexts(owner.id), [], 'stale account context cannot attach the captured local folder')
  assert.deepEqual(store.sessionWorkspace(owner.id), { workspaces: [], repos: [], connectors: [], attachments: [] })
})
