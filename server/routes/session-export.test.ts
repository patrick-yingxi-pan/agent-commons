import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Session } from '../../contract/index.ts'
import { call } from '../testkit/http.ts'
import { store } from '../store/index.ts'
import { turns } from '../turns.ts'
import { loadState } from '../persistence/persist.ts'
import { buildRouter } from './index.ts'
import { catalogOf } from '../apiSurface.ts'

const OWNER = 'tenant-personal'
const READER = 'tenant-beta'
const FOREIGN = 'tenant-growthworks'

async function compactedSession(label: string): Promise<Session> {
  const session = store.createSession(label, OWNER)
  for (let index = 0; index < 10; index += 1) {
    store.appendMessage(session.id, {
      id: `export-${Date.now()}-${index}`,
      role: index % 2 ? 'assistant' : 'user',
      content: `Turn ${index}: exact text 😀\nline two`,
    })
  }
  const plan = store.prepareSessionCompaction(session.id)
  assert.ok(plan && plan.kind === 'ready', 'fixture must have retained originals to export')
  const compacted = store.applySessionCompaction(plan, 'Distinct compaction summary')
  assert.ok(compacted && compacted !== 'invalid')
  return compacted
}

test('conversation export is exact for owner and granted reader and has no side effects', async () => {
  const session = await compactedSession(`Conversation export ${Date.now()}`)
  const grant = store.createGrant({
    subject: { kind: 'session', id: session.id },
    audience: { kind: 'org', orgId: READER },
    tier: 'view',
  }, OWNER)
  assert.equal(typeof grant, 'object')
  const before = store.getSession(session.id)
  const stateBefore = loadState()
  const events: string[] = []
  const unsubscribe = store.subscribe((event) => events.push(event.type))
  const ownerExport = await call('GET', `/sessions/${session.id}/export`, undefined, { 'x-tenant-id': OWNER })
  assert.equal(ownerExport.status, 200)
  assert.equal(ownerExport.json.sessionId, session.id)
  assert.equal(ownerExport.json.filename, `${session.title}.md`)
  assert.equal(ownerExport.json.mediaType, 'text/markdown;charset=utf-8')
  assert.equal(ownerExport.json.archivedMessageCount, before!.compactedMessages!.length)
  assert.ok(ownerExport.json.content.includes('## Archived messages'))
  assert.ok(ownerExport.json.content.includes('### Compaction summary'))
  assert.ok(ownerExport.json.content.includes(before!.compactedMessages![0].content))
  const sharedExport = await call('GET', `/sessions/${session.id}/export`, undefined, { 'x-tenant-id': READER })
  unsubscribe()
  assert.equal(sharedExport.status, 200)
  assert.deepEqual(sharedExport.json, ownerExport.json, 'view grants expose the same bounded saved snapshot')
  assert.deepEqual(loadState(), stateBefore, 'export does not mutate persisted state')
  assert.deepEqual(events, [], 'export emits no store events')
  assert.equal((await call('GET', `/sessions/${session.id}/export`, undefined, { 'x-tenant-id': FOREIGN })).status, 404)
  assert.deepEqual(store.getSession(session.id), before)

  assert.equal(store.revokeGrant((grant as { id: string }).id, OWNER), 'ok')
  assert.equal((await call('GET', `/sessions/${session.id}/export`, undefined, { 'x-tenant-id': READER })).status, 404)
  assert.equal((await call('GET', '/sessions/missing-export-session/export', undefined, { 'x-tenant-id': OWNER })).status, 404)
  const operation = catalogOf(buildRouter()).find((item) => item.method === 'GET' && item.pattern === '/sessions/:id/export')
  assert.ok(operation)
  assert.equal(operation.access.kind, 'product')
  assert.equal(operation.access.session, 'tool')
})

test('conversation export refuses a live turn and rejects over-limit transcript before returning content', async () => {
  const session = store.createSession(`Export live ${Date.now()}`, OWNER)
  const active = turns.start(session.id, () => {})
  assert.ok(active)
  try {
    const conflict = await call('GET', `/sessions/${session.id}/export`, undefined, { 'x-tenant-id': OWNER })
    assert.equal(conflict.status, 409)
    assert.equal(conflict.json.error.code, 'conflict')
    assert.match(conflict.json.error.message, /active reply/i)
  } finally {
    turns.finish(active.id)
  }
  // Oversize coverage is exercised with a synthetic read snapshot so the route
  // does not persist an 8 MiB fixture into the shared test database.
  const getSession = store.getSession
  const original = getSession.call(store, session.id)!
  store.getSession = ((id: string) => id === session.id
    ? { ...original, messages: [{ id: 'large', role: 'user', content: 'x'.repeat(8 * 1024 * 1024) }] }
    : getSession.call(store, id)) as typeof store.getSession
  try {
    const oversized = await call('GET', `/sessions/${session.id}/export`, undefined, { 'x-tenant-id': OWNER })
    assert.equal(oversized.status, 413)
    assert.equal(oversized.json.error.code, 'bad_request')
    assert.equal(oversized.json.content, undefined, 'oversized exports never return partial content')
  } finally {
    store.getSession = getSession
  }
})
