/** Regression baseline for the store spine the broker work touches — capabilities,
 *  sessions, usage, the event bus, recents — plus the new registry seed. Guards
 *  against breaking existing behavior while the architecture grows. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from '../server/store.ts'

test('capabilities: the mock backend reports its native features true', () => {
  const caps = store.capabilities()
  assert.equal(caps.backend, 'mock')
  assert.equal(caps.features.localFs, true)
  assert.equal(caps.features.streaming, true)
  assert.equal(typeof caps.epoch, 'string')
})

test('sessions: the list is non-empty and the demo session resolves', () => {
  const sessions = store.listSessions()
  assert.ok(Array.isArray(sessions))
  assert.ok(sessions.length > 0)
  assert.ok(store.getSession(store.demoSessionId))
})

test('usage: the snapshot has the gauge shape', () => {
  const u = store.usage()
  assert.ok(u.context)
  assert.ok(Array.isArray(u.limits))
})

test('event bus: a subscriber receives emits; unsubscribe stops them', () => {
  const got: string[] = []
  const off = store.subscribe((e) => got.push(e.type))
  store.emit({ type: 'hello', epoch: 'x' })
  off()
  store.emit({ type: 'hello', epoch: 'y' })
  assert.deepEqual(got, ['hello'])
})

test('pushRecent prepends and broadcasts recents.changed', () => {
  const got: Array<{ ids: string[] }> = []
  const off = store.subscribe((e) => {
    if (e.type === 'recents.changed') got.push(e)
  })
  const snap = store.pushRecent('repo', 'repo-zzz')
  off()
  assert.equal(snap.repo[0], 'repo-zzz')
  assert.equal(got.length, 1)
  assert.equal(got[0].ids[0], 'repo-zzz')
})

test('registry: native mode seeds the co-located agent with fs/terminal/process', () => {
  const ids = store.registry.list().map((a) => a.id)
  assert.ok(ids.includes('agent-local'))
  const local = store.registry.get('agent-local')
  assert.ok(local)
  assert.equal(local.status, 'online')
  assert.ok(local.capabilities.some((c) => c.type === 'fs.read'))
  assert.ok(local.capabilities.some((c) => c.type === 'terminal'))
})
