/** Owner-walled Refresh of frozen native Git working-tree bytes. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from '../store/index.ts'
import { call, callFresh } from '../testkit/http.ts'
import type { LocalGitCapture } from '../../contract/localGitCapture.ts'
import { fsRecentKey } from '../../contract/fs.ts'

const EMPTY = { workspaces: [], repos: [], connectors: [], attachments: [] }
const REQUEST_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const CONNECTION = 'GIT_0123456789ABCDEF0123456789ABCDEF'
let sequence = 0

function capture(overrides: Partial<LocalGitCapture> = {}): LocalGitCapture {
  return {
    version: 1,
    snapshotId: REQUEST_ID,
    capturedAt: '2026-10-04T12:00:00.000Z',
    connectionId: CONNECTION,
    files: [{ path: 'src/notes.md', sizeBytes: 15, snapshot: { text: 'captured folder' } }],
    ...overrides,
  }
}

async function ownedSession() {
  const tenant = `local-git-owner-${++sequence}`
  const session = store.createSession(`local Git snapshot ${sequence}`, tenant)
  return { id: session.id, tenant, headers: { 'x-tenant-id': tenant, 'x-account-transition-source': 'unsigned' } }
}

function workspace(folders: Array<{ id: string; label: string; gitSnapshot?: LocalGitCapture }>) {
  return { ...EMPTY, workspaces: [{ id: 'workspace-main', label: 'Workspace', artifacts: [], folders }] }
}

async function attach(owner: Awaited<ReturnType<typeof ownedSession>>, headers = owner.headers) {
  const id = fsRecentKey('ui-host', CONNECTION)
  const label = 'Agent Commons/'
  return call('PATCH', `/sessions/${owner.id}/context-state`, {
    operations: [{
      action: 'attach', context: { id, type: 'folder', label, scope: CONNECTION, source: { id: 'ui-host', kind: 'ui-host', label: 'This computer' } },
    }],
    workspace: workspace([{ id, label }]),
  }, headers)
}

function refresh(owner: Awaited<ReturnType<typeof ownedSession>>, expectedSnapshotId: string | null, snapshot: LocalGitCapture, headers = owner.headers) {
  const folderId = fsRecentKey('ui-host', CONNECTION)
  return call('POST', `/sessions/${owner.id}/workspace/folders/${encodeURIComponent(folderId)}/local-git-refresh`, {
    expectedSnapshotId, requestId: snapshot.snapshotId, snapshot,
  }, headers)
}

test('Git Refresh commits only the attached saved snapshot, preserves it across stale workspace writes, and replays exact receipts', async () => {
  const owner = await ownedSession()
  assert.equal((await attach(owner)).status, 200)
  const first = capture()
  const result = await refresh(owner, null, first)
  assert.equal(result.status, 200)
  assert.deepEqual(result.json.workspace.workspaces[0].folders[0].gitSnapshot, first)
  assert.equal(result.json.workspace.workspaces[0].folders[0].localSnapshot, undefined)
  assert.deepEqual(result.json.workspace.workspaces[0].artifacts, [])
  assert.deepEqual(store.sessionWorkspace(owner.id), result.json.workspace)

  const stale = await call('PATCH', `/sessions/${owner.id}/context-state`, { operations: [], workspace: workspace([{ id: fsRecentKey('ui-host', CONNECTION), label: 'Agent Commons/' }]) }, owner.headers)
  assert.equal(stale.status, 200)
  assert.deepEqual(stale.json.workspace, result.json.workspace, 'ordinary context writes cannot rewind the saved Git receipt')
  const replay = await callFresh('POST', `/sessions/${owner.id}/workspace/folders/${encodeURIComponent(fsRecentKey('ui-host', CONNECTION))}/local-git-refresh`, {
    expectedSnapshotId: null, requestId: first.snapshotId, snapshot: first,
  }, owner.headers)
  assert.equal(replay.status, 200)
  assert.deepEqual(replay.json.workspace, result.json.workspace)
  const changed = await refresh(owner, null, capture({ files: [{ path: 'src/notes.md', sizeBytes: 7, snapshot: { text: 'changed' } }] }))
  assert.equal(changed.status, 409, 'the same request key cannot describe different saved bytes')
})

test('Git Refresh requires the current owner, account source, exact attached binding, and a matching bounded capture', async () => {
  const owner = await ownedSession()
  assert.equal((await refresh(owner, null, capture())).status, 409, 'refresh cannot create attachment authority')
  assert.equal((await attach(owner)).status, 200)
  assert.equal((await refresh(owner, null, capture({ connectionId: 'GIT_1123456789ABCDEF0123456789ABCDEF' }))).status, 409)
  assert.equal((await refresh(owner, null, capture({ files: [{ path: '../outside.md', sizeBytes: 1, snapshot: { text: 'x' } }] }))).status, 400)
  const stale = await refresh(owner, null, capture(), { ...owner.headers, 'x-account-transition-source': 'session:stale-user' })
  assert.equal(stale.status, 409)
  const foreign = await refresh(owner, null, capture(), { 'x-tenant-id': `local-git-foreign-${++sequence}`, 'x-account-transition-source': 'unsigned' })
  assert.equal(foreign.status, 404)
  const detached = await call('PATCH', `/sessions/${owner.id}/context-state`, {
    operations: [{ action: 'detach', contextId: fsRecentKey('ui-host', CONNECTION) }], workspace: workspace([]),
  }, owner.headers)
  assert.equal(detached.status, 200)
  assert.equal((await refresh(owner, null, capture())).status, 409, 'a detached connection cannot revive its receipt')
})
