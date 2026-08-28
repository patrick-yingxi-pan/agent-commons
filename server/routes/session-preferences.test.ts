import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SESSION_COOKIE, signSession } from '../auth.ts'
import { call } from '../testkit/http.ts'

const adaHeaders = {
  cookie: `${SESSION_COOKIE}=${signSession({ userId: 'user-ada', tenantId: 'tenant-acme', iat: Date.now() })}`,
}

test('session detail projects an isolated unset/closed/focused preference per viewer', async () => {
  const localBefore = await call('GET', '/sessions/auth-refactor')
  const repoId = localBefore.json.workspace.repos[0].id as string
  assert.deepEqual(localBefore.json.viewerPreferences, {})

  const localClosed = await call('PATCH', '/sessions/auth-refactor/preferences', { panelFocus: null })
  assert.equal(localClosed.status, 200)
  assert.deepEqual(localClosed.json, { panelFocus: null })

  const adaBefore = await call('GET', '/sessions/auth-refactor', undefined, adaHeaders)
  assert.deepEqual(adaBefore.json.viewerPreferences, {}, 'Ada does not inherit the local device owner’s close')
  const adaFocused = await call(
    'PATCH',
    '/sessions/auth-refactor/preferences',
    { panelFocus: { kind: 'repo', id: repoId } },
    adaHeaders,
  )
  assert.equal(adaFocused.status, 200)
  assert.deepEqual(adaFocused.json, { panelFocus: { kind: 'repo', id: repoId } })

  assert.deepEqual((await call('GET', '/sessions/auth-refactor')).json.viewerPreferences, { panelFocus: null })
  assert.deepEqual((await call('GET', '/sessions/auth-refactor', undefined, adaHeaders)).json.viewerPreferences, {
    panelFocus: { kind: 'repo', id: repoId },
  })
})

test('the preference route rejects empty, malformed, dangling, and foreign targets', async () => {
  const empty = await call('PATCH', '/sessions/auth-refactor/preferences', {})
  assert.equal(empty.status, 400)
  assert.match(empty.json.error.message, /panelFocus is required/)

  const malformed = await call('PATCH', '/sessions/auth-refactor/preferences', { panelFocus: { kind: 'planet', id: 'x' } })
  assert.equal(malformed.status, 400)
  assert.match(malformed.json.error.message, /valid context focus/)

  const dangling = await call('PATCH', '/sessions/auth-refactor/preferences', { panelFocus: { kind: 'repo', id: 'missing' } })
  assert.equal(dangling.status, 400)
  assert.match(dangling.json.error.message, /not attached/)

  const created = await call(
    'POST',
    '/sessions',
    { firstMessage: 'private preference target' },
    { 'x-tenant-id': 'tenant-pref-owner' },
  )
  const foreign = await call(
    'PATCH',
    `/sessions/${created.json.id}/preferences`,
    { panelFocus: null },
    { 'x-tenant-id': 'tenant-pref-stranger' },
  )
  assert.equal(foreign.status, 404, 'the standard existence-hiding session wall applies')
  assert.equal(foreign.json.error.code, 'not_found')
})

test('removing a context from the session workspace prunes its durable focus to closed', async () => {
  const created = await call('POST', '/sessions', { firstMessage: 'preference prune integration' })
  const workspace = {
    workspaces: [],
    repos: [{ id: 'repo-prune', label: 'me/prune', origin: 'github', branch: 'main', files: [], diff: [], terminal: [] }],
    connectors: [],
    attachments: [],
  }
  assert.equal((await call('PATCH', `/sessions/${created.json.id}/context-state`, {
    operations: [{
      action: 'attach',
      context: { id: 'repo-prune', type: 'repo', label: 'me/prune', scope: '*' },
    }],
    workspace,
  })).status, 200)
  assert.equal((await call('PATCH', `/sessions/${created.json.id}/preferences`, {
    panelFocus: { kind: 'repo', id: 'repo-prune' },
  })).status, 200)

  assert.equal((await call('PATCH', `/sessions/${created.json.id}/context-state`, {
    operations: [{ action: 'detach', contextId: 'repo-prune' }],
    workspace: { ...workspace, repos: [] },
  })).status, 200)
  const reread = await call('GET', `/sessions/${created.json.id}`)
  assert.deepEqual(reread.json.viewerPreferences, { panelFocus: null })
})
