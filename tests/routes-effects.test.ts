/** Integration tests for the system-of-record routes (D2): idempotent invoke,
 *  the effect-log read-through, and the outbox sync — through the real router. */
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { call } from './helpers/http.ts'

// Effects are context-mediated (D5): each invoke names a session + an attached
// context. A permissive context (scope '*') keeps these system-of-record tests
// focused on journaling rather than on the mediation check.
before(async () => {
  await call('POST', '/sessions/seff/contexts', { id: 'cx-all', type: 'folder', label: 'all', scope: '*' })
})

test('invoke records an effect with a commandId and agentSeq', async () => {
  const { status, json } = await call('POST', '/agents/agent-local/invoke', {
    sessionId: 'seff',
    contextId: 'cx-all',
    capability: 'fs.read',
    target: '~/projects/a.ts',
    commandId: 'cmd-eff-1',
  })
  assert.equal(status, 200)
  assert.equal(json.commandId, 'cmd-eff-1')
  assert.equal(typeof json.agentSeq, 'number')

  const log = await call('GET', '/agents/agent-local/effects')
  assert.ok(log.json.some((e: any) => e.commandId === 'cmd-eff-1'))
})

test('invoke is idempotent — a retry with the same commandId does not re-record', async () => {
  await call('POST', '/agents/agent-local/invoke', {
    sessionId: 'seff',
    contextId: 'cx-all',
    capability: 'terminal',
    target: 'echo hi',
    commandId: 'cmd-idem',
  })
  const before = await call('GET', '/agents/agent-local/effects')
  const retry = await call('POST', '/agents/agent-local/invoke', {
    sessionId: 'seff',
    contextId: 'cx-all',
    capability: 'terminal',
    target: 'echo DIFFERENT',
    commandId: 'cmd-idem',
  })
  const after = await call('GET', '/agents/agent-local/effects')

  assert.equal(retry.json.target, 'echo hi') // original effect replayed, not the retry's
  assert.equal(after.json.length, before.json.length) // count unchanged
})

test('effects?since returns only the tail after a sequence number', async () => {
  const full = await call('GET', '/agents/agent-local/effects')
  const maxSeq = Math.max(0, ...full.json.map((e: any) => e.agentSeq))
  await call('POST', '/agents/agent-local/invoke', {
    sessionId: 'seff',
    contextId: 'cx-all',
    capability: 'fs.read',
    target: '~/projects/tail.ts',
    commandId: `cmd-tail-${maxSeq}`,
  })
  const tail = await call('GET', `/agents/agent-local/effects?since=${maxSeq}`)
  assert.ok(tail.json.every((e: any) => e.agentSeq > maxSeq))
  assert.ok(tail.json.some((e: any) => e.target === '~/projects/tail.ts'))
})

test('sync merges an agent outbox idempotently and reports the projected delta', async () => {
  // Enroll a fresh agent so its log starts empty.
  await call('POST', '/agents', {
    id: 'agent-sync-1',
    label: 'S',
    host: 'h',
    capabilities: [{ type: 'fs.write', scopes: ['~/out'] }],
  })

  const first = await call('POST', '/agents/agent-sync-1/sync', {
    effects: [
      { commandId: 's1', capability: 'fs.write', target: '~/out/a', output: { written: true } },
      { commandId: 's2', capability: 'fs.write', target: '~/out/b', output: { written: true } },
    ],
  })
  assert.equal(first.status, 200)
  assert.equal(first.json.projected.length, 2)
  assert.equal(first.json.cursor, 2)

  // Replay s2 (dup) + s3 (new): only s3 should newly project.
  const second = await call('POST', '/agents/agent-sync-1/sync', {
    effects: [
      { commandId: 's2', capability: 'fs.write', target: '~/out/b', output: { written: true } },
      { commandId: 's3', capability: 'fs.write', target: '~/out/c', output: { written: true } },
    ],
  })
  assert.deepEqual(
    second.json.projected.map((e: any) => e.commandId),
    ['s3'],
  )
  assert.equal(second.json.cursor, 3)

  const log = await call('GET', '/agents/agent-sync-1/effects')
  assert.equal(log.json.length, 3) // s1, s2, s3 — no duplicate
})

test('effects / sync on an unknown agent 404', async () => {
  const read = await call('GET', '/agents/ghost/effects')
  assert.equal(read.status, 404)
  const sync = await call('POST', '/agents/ghost/sync', { effects: [] })
  assert.equal(sync.status, 404)
})
