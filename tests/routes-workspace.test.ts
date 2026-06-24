/** Integration tests for the server-owned session workspace — the panels a
 *  conversation has grown (its attached-context content). The server materializes
 *  it from the flat seed fields and persists the client's attach/detach
 *  write-through, so a runtime attach survives a reload (the way the conversation
 *  does). Through the real router + store. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { call } from './helpers/http.ts'

test('GET /sessions/:id materializes the workspace from the seed (repo + connectors)', async () => {
  const { json } = await call('GET', '/sessions/auth-refactor')
  assert.ok(json.workspace, 'the session carries a live workspace')
  assert.equal(json.workspace.workspaces.length, 0, 'no artifacts → no workspace panel')
  assert.equal(json.workspace.repos.length, 1, 'its files/diff/terminal → one repo')
  assert.equal(json.workspace.repos[0].id, 'repo-auth-refactor')
  assert.equal(json.workspace.repos[0].branch, 'refactor/auth-middleware')
  assert.equal(json.workspace.connectors.length, 1)
  assert.deepEqual(json.workspace.attachments, [])
})

test('a workspace-only seed session derives a workspace panel from its artifacts', async () => {
  const { json } = await call('GET', '/sessions/onboarding-ab')
  assert.equal(json.workspace.repos.length, 0)
  assert.equal(json.workspace.workspaces.length, 1)
  assert.equal(json.workspace.workspaces[0].artifacts.length, 2)
})

test('a freshly created session starts with an empty workspace', async () => {
  const { json: s } = await call('POST', '/sessions', { firstMessage: 'fresh thread' })
  const { json } = await call('GET', `/sessions/${s.id}`)
  assert.deepEqual(json.workspace, { workspaces: [], repos: [], connectors: [], attachments: [] })
})

test('PATCH /sessions/:id/workspace persists the panels and reads them back', async () => {
  const { json: s } = await call('POST', '/sessions', { firstMessage: 'attach a repo here' })
  const workspace = {
    workspaces: [{ id: 'ws-active', label: 'launch/', artifacts: [{ id: 'a1', name: 'brief.md', kind: 'doc', meta: 'draft' }] }],
    repos: [{ id: 'repo-x', label: 'me/x', origin: 'github', remote: 'me/x', branch: 'main', files: [], diff: [], terminal: [] }],
    connectors: [{ id: 'c1', label: 'GitHub', kind: 'github' }],
    attachments: [{ id: 'f1', label: 'logo.png', kind: 'photo' }],
  }
  const patched = await call('PATCH', `/sessions/${s.id}/workspace`, workspace)
  assert.equal(patched.status, 200)
  assert.deepEqual(patched.json.workspace, workspace, 'the response carries the stored workspace')

  // It survives a re-read (the system of record) — a runtime attach persists.
  const reread = await call('GET', `/sessions/${s.id}`)
  assert.deepEqual(reread.json.workspace, workspace)
})

test('PATCH workspace rejects a malformed body and an unknown session', async () => {
  const { json: s } = await call('POST', '/sessions', {})
  const bad = await call('PATCH', `/sessions/${s.id}/workspace`, { workspaces: [] })
  assert.equal(bad.status, 400)
  assert.equal(bad.json.error.code, 'bad_request')

  const ghost = await call('PATCH', '/sessions/ghost-xyz/workspace', {
    workspaces: [], repos: [], connectors: [], attachments: [],
  })
  assert.equal(ghost.status, 404)
  assert.equal(ghost.json.error.code, 'not_found')
})
