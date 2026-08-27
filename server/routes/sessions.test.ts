/** Integration tests for the session lifecycle, through the real router + store:
 *  materializing a draft into a real session (POST /sessions) and persisting a
 *  turn (POST /sessions/:id/messages) so the conversation is server-owned — a sent
 *  message survives a reload. The reply *text* is canned (the model seam); its
 *  *persistence* is what these assert. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { call, callRaw } from '../testkit/http.ts'
import { store } from '../store/index.ts'
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
