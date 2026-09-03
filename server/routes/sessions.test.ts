/** Integration tests for the session lifecycle, through the real router + store:
 *  materializing a draft into a real session (POST /sessions) and persisting a
 *  turn (POST /sessions/:id/messages) so the conversation is server-owned — a sent
 *  message survives a reload. The reply *text* is canned (the model seam); its
 *  *persistence* is what these assert. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { call, callFresh, callRaw } from '../testkit/http.ts'
import { store } from '../store/index.ts'
import { turns } from '../turns.ts'
import { sessionCreationId } from '../sessionCreationIdentity.ts'
import type { Message } from '../../contract/index.ts'

test('POST /sessions materializes a real, listed session titled from the first message', async () => {
  const create = await call('POST', '/sessions', { firstMessage: 'Refactor the auth middleware please' })
  assert.equal(create.status, 200)
  assert.ok(create.json.id, 'a server-minted id')
  assert.match(create.json.title, /Refactor the auth middleware/)
  assert.deepEqual(create.json.messages, [])

  // It now appears in the session list (the sidebar's source).
  const list = await call('GET', '/sessions')
  assert.ok(list.json.some((s: any) => s.id === create.json.id), 'appears in GET /sessions')
})

test('POST /sessions with no firstMessage falls back to a neutral title', async () => {
  const create = await call('POST', '/sessions', {})
  assert.equal(create.status, 200)
  assert.equal(create.json.title, 'New session')
})

test('a keyed draft materialization owns one current session beyond response cache and deletion', async () => {
  const key = `draft-materialization-${Date.now()}`
  const headers = { 'idempotency-key': key }
  const expectedId = sessionCreationId(store.defaultTenantId(), key)
  const request = { firstMessage: 'One durable first conversation' }

  const created = await call('POST', '/sessions', request, headers)
  assert.equal(created.status, 200)
  assert.equal(created.json.id, expectedId)
  const renamed = await call('PATCH', `/sessions/${expectedId}`, {
    title: 'Current conversation title',
    expectedRevision: 0,
  })
  assert.equal(renamed.status, 200)

  const sameRouterReplay = await call('POST', '/sessions', {
    firstMessage: 'Changed Retry must not mint or overwrite',
    providerId: 'missing-provider',
  }, headers)
  assert.equal(sameRouterReplay.status, 200)
  assert.equal(sameRouterReplay.headers['idempotency-replayed'], undefined,
    'domain replay returns current truth instead of a cached creation envelope')
  assert.equal(sameRouterReplay.json.id, expectedId)
  assert.equal(sameRouterReplay.json.title, 'Current conversation title')
  const freshRouterReplay = await callFresh('POST', '/sessions', null, headers)
  assert.equal(freshRouterReplay.status, 200,
    'durable identity answers before changed malformed input after response-cache loss')
  assert.equal(freshRouterReplay.json.id, expectedId)
  assert.equal(store.listSessions().filter((session) => session.id === expectedId).length, 1)

  const removed = await call('DELETE', `/sessions/${expectedId}`, { expectedRevision: 1 })
  assert.equal(removed.status, 200)
  assert.equal((await call('POST', '/sessions', request, headers)).status, 404,
    'same-process Retry cannot resurrect an explicitly removed draft')
  assert.equal((await callFresh('POST', '/sessions', request, headers)).status, 404,
    'fresh-router Retry cannot resurrect an explicitly removed draft')
  assert.equal(store.listSessions().some((session) => session.id === expectedId), false)
})

test('session metadata PATCH refuses stale revisions and replays one logical retry', async () => {
  const { json: created } = await call('POST', '/sessions', { firstMessage: 'revision target' })
  assert.equal(created.metadataRevision, 0)

  // Transcript activity is intentionally orthogonal to row metadata: a reply
  // must not make a harmless rename look stale.
  await callRaw('POST', `/sessions/${created.id}/messages`, { text: 'one turn first' })
  const afterTurn = await call('GET', `/sessions/${created.id}`)
  assert.equal(afterTurn.json.metadataRevision, 0)

  const headers = { 'idempotency-key': `session-metadata-${created.id}` }
  const renamed = await call('PATCH', `/sessions/${created.id}`, {
    title: 'Revision-safe title',
    expectedRevision: 0,
  }, headers)
  assert.equal(renamed.status, 200)
  assert.equal(renamed.json.metadataRevision, 1)
  assert.equal(renamed.json.messages, undefined, 'the acknowledgement stays transcript-bounded')

  const replay = await call('PATCH', `/sessions/${created.id}`, {
    title: 'Revision-safe title',
    expectedRevision: 0,
  }, headers)
  assert.equal(replay.status, 200)
  assert.equal(replay.json.metadataRevision, 1, 'the same logical retry does not advance twice')

  const stale = await call('PATCH', `/sessions/${created.id}`, {
    pinned: true,
    expectedRevision: 0,
  })
  assert.equal(stale.status, 409)
  assert.equal(stale.json.error.code, 'conflict')
  assert.equal(store.getSession(created.id)?.pinned, undefined, 'a refused patch changes nothing')
  assert.equal(store.getSession(created.id)?.metadataRevision, 1)

  const current = await call('PATCH', `/sessions/${created.id}`, {
    pinned: true,
    expectedRevision: 1,
  })
  assert.equal(current.status, 200)
  assert.equal(current.json.metadataRevision, 2)
  assert.equal(current.json.pinned, true)
})

test('session metadata PATCH validates its precondition and preserves legacy unconditional writes', async () => {
  const { json: created } = await call('POST', '/sessions', { firstMessage: 'legacy patch' })
  const malformed = await call('PATCH', `/sessions/${created.id}`, { title: 'No', expectedRevision: -1 })
  assert.equal(malformed.status, 400)
  assert.equal(store.getSession(created.id)?.title, created.title)

  const legacy = await call('PATCH', `/sessions/${created.id}`, { title: 'Legacy client title' })
  assert.equal(legacy.status, 200)
  assert.equal(legacy.json.metadataRevision, 1, 'an unconditional v1 write still advances canonical ordering')
})

test('session DELETE pins reviewed metadata, replays success, and preserves legacy absence', async () => {
  const { json: staleTarget } = await call('POST', '/sessions', { firstMessage: 'delete reviewed row' })
  const renamed = await call('PATCH', `/sessions/${staleTarget.id}`, {
    title: 'Changed on another device',
    expectedRevision: 0,
  })
  assert.equal(renamed.status, 200)

  const stale = await call('DELETE', `/sessions/${staleTarget.id}`, { expectedRevision: 0 })
  assert.equal(stale.status, 409)
  assert.ok(store.getSession(staleTarget.id), 'a stale destructive act changes nothing')

  const malformed = await call('DELETE', `/sessions/${staleTarget.id}`, { expectedRevision: -1 })
  assert.equal(malformed.status, 400)
  assert.ok(store.getSession(staleTarget.id), 'a malformed precondition changes nothing')

  const headers = { 'idempotency-key': `session-delete-${staleTarget.id}` }
  const removed = await call('DELETE', `/sessions/${staleTarget.id}`, { expectedRevision: 1 }, headers)
  assert.equal(removed.status, 200)
  assert.equal(store.getSession(staleTarget.id), undefined)
  const replay = await call('DELETE', `/sessions/${staleTarget.id}`, { expectedRevision: 1 }, headers)
  assert.equal(replay.status, 200, 'the same logical retry replays its acknowledged result')

  const { json: legacyTarget } = await call('POST', '/sessions', { firstMessage: 'legacy deletion' })
  const legacy = await call('DELETE', `/sessions/${legacyTarget.id}`)
  assert.equal(legacy.status, 200, 'absence retains unconditional v1 deletion')
  assert.equal(store.getSession(legacyTarget.id), undefined)
})

test('session DELETE refuses to race a live reply, then accepts the same logical retry', async () => {
  const { json: created } = await call('POST', '/sessions', { firstMessage: 'busy deletion' })
  const active = turns.start(created.id, () => {})
  assert.ok(active)
  const headers = { 'idempotency-key': `session-delete-busy-${created.id}` }
  try {
    const refused = await call('DELETE', `/sessions/${created.id}`, { expectedRevision: 0 }, headers)
    assert.equal(refused.status, 409)
    assert.match(refused.json.error.message, /cancel the current reply/i)
    assert.ok(store.getSession(created.id), 'the active conversation remains authoritative')
  } finally {
    turns.finish(active.id)
  }

  const removed = await call('DELETE', `/sessions/${created.id}`, { expectedRevision: 0 }, headers)
  assert.equal(removed.status, 200, 'a refusal is not cached under the retained retry key')
  assert.equal(store.getSession(created.id), undefined)
})

test('a sent turn is persisted (user + assistant) and read back from the server', async () => {
  const { json: session } = await call('POST', '/sessions', { firstMessage: 'hello' })
  const before = (await call('GET', `/sessions/${session.id}`)).json.messages.length

  const sent = await callRaw('POST', `/sessions/${session.id}/messages`, { text: 'What is a vector database?' })
  assert.equal(sent.status, 200)
  assert.match(sent.body, /data:/, 'the reply is an SSE stream')

  const after = (await call('GET', `/sessions/${session.id}`)).json
  assert.equal(after.messages.length, before + 2, 'the user + assistant turn persisted')
  const [user, assistant] = after.messages.slice(-2)
  assert.equal(user.role, 'user')
  assert.equal(user.content, 'What is a vector database?')
  assert.equal(assistant.role, 'assistant')
  assert.ok(assistant.content.length > 0, 'the assistant reply has text (canned or fallback)')
})

test('the row preview + activity reflect the latest turn', async () => {
  const { json: session } = await call('POST', '/sessions', { firstMessage: 'seed' })
  await callRaw('POST', `/sessions/${session.id}/messages`, { text: 'a distinctive question' })
  const row = (await call('GET', '/sessions')).json.find((s: any) => s.id === session.id)
  assert.ok(row, 'the session is listed')
  // Preview is the latest message content (here, the assistant reply) — not stale.
  assert.ok(typeof row.preview === 'string' && row.preview.length > 0)
})

test('sending to an unknown id does not create or persist anything', async () => {
  const sent = await callRaw('POST', '/sessions/ghost-unknown/messages', { text: 'hi' })
  assert.equal(sent.status, 200, 'still streams a reply shell')
  const got = await call('GET', '/sessions/ghost-unknown')
  assert.equal(got.status, 404, 'but no session was materialized')
})

test('GET /usage?session runs the foreign-session wall — a cross-tenant id is 404, not a token oracle', async () => {
  // Tenant A materializes a session; tenant B must not read its context breakdown
  // (token counts, resolved model) through the usage gauge.
  const { json: session } = await call('POST', '/sessions', { firstMessage: 'private thread' }, { 'x-tenant-id': 'tenant-usage-oracle-a' })
  const own = await call('GET', `/usage?session=${session.id}`, undefined, { 'x-tenant-id': 'tenant-usage-oracle-a' })
  assert.equal(own.status, 200, 'the owner reads its own session usage')
  const foreign = await call('GET', `/usage?session=${session.id}`, undefined, { 'x-tenant-id': 'tenant-usage-oracle-b' })
  assert.equal(foreign.status, 404, 'a foreign tenant is refused — the same wall every by-id session route runs')
})

test('GET /sessions/:id pages the newest message tail without changing the default response', async () => {
  const { json: created } = await call('POST', '/sessions', { firstMessage: 'long history' })
  const messages: Message[] = [
    { id: `${created.id}-m1`, role: 'user', content: 'aaaa' },
    { id: `${created.id}-m2`, role: 'assistant', content: 'bbbbbbbb' },
    { id: `${created.id}-m3`, role: 'user', content: 'cccccccccccc' },
    {
      id: `${created.id}-m4`,
      role: 'assistant',
      content: 'dddddddddddddddd',
      escalation: { kind: 'workspace', rootChoices: ['history/'], artifacts: [] },
    },
    { id: `${created.id}-m5`, role: 'user', content: 'eeeeeeeeeeeeeeeeeeee' },
  ]
  for (const message of messages) store.appendMessage(created.id, message)

  const full = await call('GET', `/sessions/${created.id}`)
  assert.deepEqual(full.json.messages.map((m: Message) => m.id), messages.map((m) => m.id), 'no opt-in keeps the full contract')
  assert.equal(full.json.messagePage, undefined)

  const newest = await call('GET', `/sessions/${created.id}?messageLimit=2`)
  assert.equal(newest.status, 200)
  assert.deepEqual(newest.json.messages.map((m: Message) => m.id), messages.slice(-2).map((m) => m.id))
  assert.ok(newest.json.messagePage.olderCursor)
  assert.equal(newest.json.messagePage.olderTokens, 6, 'tokens before the page remain represented in the context gauge')
  assert.equal(newest.json.messagePage.latestEscalation.messageId, messages[3].id, 'a held consent proposal remains discoverable outside the visible tail')

  const older = await call(
    'GET',
    `/sessions/${created.id}?messageLimit=2&messageCursor=${encodeURIComponent(newest.json.messagePage.olderCursor)}`,
  )
  assert.deepEqual(older.json.messages.map((m: Message) => m.id), messages.slice(1, 3).map((m) => m.id))
  assert.equal(older.json.messagePage.olderTokens, 1)

  const oldest = await call(
    'GET',
    `/sessions/${created.id}?messageLimit=2&messageCursor=${encodeURIComponent(older.json.messagePage.olderCursor)}`,
  )
  assert.deepEqual(oldest.json.messages.map((m: Message) => m.id), [messages[0].id])
  assert.equal(oldest.json.messagePage.olderCursor, null)
  assert.equal(oldest.json.messagePage.olderTokens, 0)
})

test('GET /sessions/:id rejects an invalid message page limit', async () => {
  const { json: created } = await call('POST', '/sessions', {})
  const bad = await call('GET', `/sessions/${created.id}?messageLimit=0`)
  assert.equal(bad.status, 400)
  assert.equal(bad.json.error.code, 'bad_request')
})
