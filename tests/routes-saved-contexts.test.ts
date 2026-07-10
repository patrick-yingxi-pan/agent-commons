/** The saved-contexts auth seam through the real router + store: a connect /
 *  disconnect on the Contexts page is a real server mutation that updates the
 *  server-owned status and the derived "Connected" quick lists (and broadcasts
 *  `connector.status`, asserted in the store's event-bus tests). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { call } from './helpers/http.ts'

const find = (snap: any, id: string) => snap.contexts.find((c: any) => c.id === id)

test('PATCH /saved-contexts/:id disconnects a connector; the snapshot + connected list reflect it', async () => {
  const before = (await call('GET', '/saved-contexts')).json
  assert.equal(find(before, 'slack').status, 'connected', 'slack seeds connected')
  assert.ok(before.connectedConnectorIds.includes('slack'))

  const patched = await call('PATCH', '/saved-contexts/slack', { status: 'needs-auth' })
  assert.equal(patched.status, 200)
  assert.equal(find(patched.json, 'slack').status, 'needs-auth')
  assert.ok(!patched.json.connectedConnectorIds.includes('slack'), 'dropped from the Connected quick list')

  // Server-owned, not just the response: a fresh GET reflects the change.
  const after = (await call('GET', '/saved-contexts')).json
  assert.equal(find(after, 'slack').status, 'needs-auth')
})

test('PATCH /saved-contexts/:id reconnects, and the connected list comes back', async () => {
  await call('PATCH', '/saved-contexts/slack', { status: 'needs-auth' })
  const back = await call('PATCH', '/saved-contexts/slack', { status: 'connected' })
  assert.equal(back.status, 200)
  assert.equal(find(back.json, 'slack').status, 'connected')
  assert.ok(back.json.connectedConnectorIds.includes('slack'))
})

test('PATCH /saved-contexts/:id with an invalid status is 400 bad_request', async () => {
  const r = await call('PATCH', '/saved-contexts/slack', { status: 'bogus' })
  assert.equal(r.status, 400)
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
})
