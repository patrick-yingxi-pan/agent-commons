/** The saved-contexts auth seam through the real router + store: a connect /
 *  disconnect on the Contexts page is a real server mutation that updates the
 *  server-owned status and the derived "Connected" quick lists (and broadcasts
 *  `connector.status`, asserted in the store's event-bus tests). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { call } from '../testkit/http.ts'

const find = (snap: any, id: string) => snap.contexts.find((c: any) => c.id === id)

test('PATCH /saved-contexts/:id disconnects a connector; the snapshot + connected list reflect it', async () => {
  const before = (await call('GET', '/saved-contexts')).json
  assert.equal(find(before, 'slack').status, 'connected', 'slack seeds connected')
  assert.equal(find(before, 'slack').connectionRevision, 0, 'legacy/seed rows project revision zero')
  assert.ok(before.connectedConnectorIds.includes('slack'))

  const patched = await call('PATCH', '/saved-contexts/slack', { status: 'needs-auth', expectedRevision: 0 })
  assert.equal(patched.status, 200)
  assert.equal(find(patched.json, 'slack').status, 'needs-auth')
  assert.equal(find(patched.json, 'slack').connectionRevision, 1)
  assert.ok(!patched.json.connectedConnectorIds.includes('slack'), 'dropped from the Connected quick list')

  // Server-owned, not just the response: a fresh GET reflects the change.
  const after = (await call('GET', '/saved-contexts')).json
  assert.equal(find(after, 'slack').status, 'needs-auth')
})

test('PATCH /saved-contexts/:id reconnects, and the connected list comes back', async () => {
  const current = find((await call('GET', '/saved-contexts')).json, 'slack')
  if (current.status === 'connected') {
    await call('PATCH', '/saved-contexts/slack', {
      status: 'needs-auth', expectedRevision: current.connectionRevision ?? 0,
    })
  }
  const disconnected = find((await call('GET', '/saved-contexts')).json, 'slack')
  const back = await call('PATCH', '/saved-contexts/slack', {
    status: 'connected', expectedRevision: disconnected.connectionRevision ?? 0,
  })
  assert.equal(back.status, 200)
  assert.equal(find(back.json, 'slack').status, 'connected')
  assert.ok(back.json.connectedConnectorIds.includes('slack'))
})

test('connection revisions conflict before mutation, replay once, and converge after a lost acknowledgement', async () => {
  const id = `rt-context-revision-${Date.now().toString(36)}`
  const context = {
    id, label: 'Revision connector', kind: 'connector', status: 'connected',
    detail: 'route revision test', lastUsedAt: null, sessions: 0,
  }
  const added = await call('POST', '/saved-contexts', { context })
  assert.equal(added.json.connectionRevision, 0)

  const headers = { 'idempotency-key': `context-status-${id}` }
  const first = await call('PATCH', `/saved-contexts/${id}`, { status: 'needs-auth', expectedRevision: 0 }, headers)
  assert.equal(first.status, 200)
  assert.equal(find(first.json, id).connectionRevision, 1)
  const replay = await call('PATCH', `/saved-contexts/${id}`, { status: 'needs-auth', expectedRevision: 0 }, headers)
  assert.deepEqual(replay.json, first.json, 'the same logical request replays its acknowledgement')

  const stale = await call('PATCH', `/saved-contexts/${id}`, { status: 'connected', expectedRevision: 0 })
  assert.equal(stale.status, 409)
  assert.match(stale.json.error.message, /changed elsewhere/)
  const afterStale = find((await call('GET', '/saved-contexts')).json, id)
  assert.equal(afterStale.status, 'needs-auth')
  assert.equal(afterStale.connectionRevision, 1, 'the refused transition advances nothing')

  const converged = await call('PATCH', `/saved-contexts/${id}`, { status: 'needs-auth', expectedRevision: 0 })
  assert.equal(converged.status, 200, 'already-realized desired state heals a post-restart replay')
  assert.equal(find(converged.json, id).connectionRevision, 1, 'convergence invents no ordering')
  await call('DELETE', `/saved-contexts/${id}`)
})

test('DELETE pins the reviewed connection revision and replays one acknowledged removal', async () => {
  const id = `rt-context-delete-${Date.now().toString(36)}`
  const context = {
    id, label: 'Deletion connector', kind: 'connector', status: 'connected',
    detail: 'route deletion test', lastUsedAt: null, sessions: 0,
  }
  await call('POST', '/saved-contexts', { context })
  await call('PATCH', `/saved-contexts/${id}`, { status: 'needs-auth', expectedRevision: 0 })

  const stale = await call('DELETE', `/saved-contexts/${id}`, { expectedRevision: 0 })
  assert.equal(stale.status, 409)
  assert.match(stale.json.error.message, /changed elsewhere/)
  assert.equal(find((await call('GET', '/saved-contexts')).json, id).connectionRevision, 1)

  const headers = { 'idempotency-key': `context-delete-${id}` }
  const removed = await call('DELETE', `/saved-contexts/${id}`, { expectedRevision: 1 }, headers)
  assert.equal(removed.status, 200)
  const replay = await call('DELETE', `/saved-contexts/${id}`, { expectedRevision: 1 }, headers)
  assert.deepEqual(replay.json, removed.json, 'the same logical removal replays after the row is absent')
  assert.equal(find((await call('GET', '/saved-contexts')).json, id), undefined)
})

test('PATCH /saved-contexts/:id with an invalid status is 400 bad_request', async () => {
  const r = await call('PATCH', '/saved-contexts/slack', { status: 'bogus' })
  assert.equal(r.status, 400)
  assert.equal((await call('PATCH', '/saved-contexts/slack', {
    status: 'connected', expectedRevision: -1,
  })).status, 400)
  assert.equal((await call('DELETE', '/saved-contexts/slack', { expectedRevision: -1 })).status, 400)
})

test('PATCH an unknown saved context is 404 not_found', async () => {
  const r = await call('PATCH', '/saved-contexts/does-not-exist', { status: 'connected' })
  assert.equal(r.status, 404)
})

test('POST /saved-contexts saves a context server-side; DELETE removes it (the page’s Add/Remove survive navigation)', async () => {
  // The Contexts page's add/remove once lived in component state and evaporated
  // when the section unmounted — the registry is now the system of record.
  const context = {
    id: 'rt-test-linear',
    label: 'Linear (route test)',
    kind: 'connector',
    connectorKind: 'connector',
    status: 'connected',
    detail: 'route test',
    lastUsedAt: 1,
    sessions: 0,
  }
  const added = await call('POST', '/saved-contexts', { context })
  assert.equal(added.status, 200)
  assert.equal(added.json.id, 'rt-test-linear')
  const listed = (await call('GET', '/saved-contexts')).json
  assert.ok(find(listed, 'rt-test-linear'), 'a fresh GET serves the saved row')

  const removed = await call('DELETE', '/saved-contexts/rt-test-linear')
  assert.equal(removed.status, 200)
  const after = (await call('GET', '/saved-contexts')).json
  assert.ok(!find(after, 'rt-test-linear'), 'a fresh GET no longer serves it')
  assert.equal((await call('DELETE', '/saved-contexts/rt-test-linear')).status, 404, 'a second delete 404s')
})

test('POST /saved-contexts without a usable context is 400', async () => {
  assert.equal((await call('POST', '/saved-contexts', {})).status, 400)
  assert.equal((await call('POST', '/saved-contexts', { context: { id: 'x' } })).status, 400)
  assert.equal((await call('POST', '/saved-contexts', { context: {
    id: 'x', label: 'x', kind: 'connector', status: 'pretend-auth', detail: 'x', lastUsedAt: null, sessions: 0,
  } })).status, 400)
})
