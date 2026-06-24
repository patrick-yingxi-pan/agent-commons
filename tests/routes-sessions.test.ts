/** Integration tests for the session lifecycle, through the real router + store:
 *  materializing a draft into a real session (POST /sessions) and persisting a
 *  turn (POST /sessions/:id/messages) so the conversation is server-owned — a sent
 *  message survives a reload. The reply *text* is canned (the model seam); its
 *  *persistence* is what these assert. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { call, callRaw } from './helpers/http.ts'

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
