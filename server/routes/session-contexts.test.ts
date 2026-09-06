/** Atomic session context state: effect-mediation bindings and their visible
 * workspace commit together, retry idempotently, and remain tenant-walled. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { call } from '../testkit/http.ts'
import { store } from '../store/index.ts'

const EMPTY = { workspaces: [], repos: [], connectors: [], attachments: [] }

async function session(label: string): Promise<string> {
  const { json } = await call('POST', '/sessions', { firstMessage: label })
  return json.id
}

test('a seeded session lists its attached contexts', async () => {
  const { status, json } = await call('GET', '/sessions/auth-refactor/contexts')
  assert.equal(status, 200)
  assert.ok(Array.isArray(json))
  assert.ok(json.some((context: any) => context.id === 'repo-auth'))
  const detail = await call('GET', '/sessions/auth-refactor')
  assert.deepEqual(detail.json.contexts, json, 'session detail projects the same binding set')
})

test('an unknown context read is an existence-hiding 404, not a synthetic empty list', async () => {
  const { status, json } = await call('GET', '/sessions/nope-no-binding/contexts')
  assert.equal(status, 404)
  assert.equal(json.error.code, 'not_found')
})

test('attach commits the binding and visible workspace together, defaulting scope to *', async () => {
  const sid = await session('atomic attach')
  const workspace = {
    ...EMPTY,
    connectors: [{ id: 'c-a', label: 'Slack', kind: 'connector' }],
  }
  const { status, json } = await call('PATCH', `/sessions/${sid}/context-state`, {
    operations: [{ action: 'attach', context: { id: 'c-a', type: 'connector', label: 'Slack' } }],
    workspace,
  })
  assert.equal(status, 200)
  assert.equal(json.contexts[0].scope, '*')
  assert.deepEqual(json.workspace, workspace)
  assert.equal(store.resolveSessionContext(sid, 'c-a')?.label, 'Slack')
  assert.deepEqual(store.sessionWorkspace(sid), workspace)
})

test('replaying an attach replaces by id and never duplicates', async () => {
  const sid = await session('idempotent attach')
  await call('PATCH', `/sessions/${sid}/context-state`, {
    operations: [{ action: 'attach', context: { id: 'c-b', type: 'repo', label: 'R', scope: '~/a' } }],
    workspace: EMPTY,
  })
  const { json } = await call('PATCH', `/sessions/${sid}/context-state`, {
    operations: [{ action: 'attach', context: { id: 'c-b', type: 'repo', label: 'R2', scope: '~/b' } }],
    workspace: EMPTY,
  })
  assert.equal(json.contexts.length, 1)
  assert.equal(json.contexts[0].label, 'R2')
  assert.equal(json.contexts[0].scope, '~/b')
})

test('detach is idempotent so retry-after-lost-ack remains safe', async () => {
  const sid = await session('idempotent detach')
  await call('PATCH', `/sessions/${sid}/context-state`, {
    operations: [{ action: 'attach', context: { id: 'c-c', type: 'folder', label: 'C', scope: '*' } }],
    workspace: EMPTY,
  })
  const request = { operations: [{ action: 'detach', contextId: 'c-c' }], workspace: EMPTY }
  assert.deepEqual((await call('PATCH', `/sessions/${sid}/context-state`, request)).json.contexts, [])
  const replay = await call('PATCH', `/sessions/${sid}/context-state`, request)
  assert.equal(replay.status, 200)
  assert.deepEqual(replay.json.contexts, [])
})

test('the route validates the complete transaction before touching either facet', async () => {
  const sid = await session('reject atomically')
  const workspace = { ...EMPTY, connectors: [{ id: 'bad', label: 'Bad', kind: 'connector' }] }
  const bad = await call('PATCH', `/sessions/${sid}/context-state`, {
    operations: [
      { action: 'attach', context: { id: 'good', type: 'connector', label: 'Good' } },
      { action: 'attach', context: { id: 'bad', type: 'unknown', label: 'Bad' } },
    ],
    workspace,
  })
  assert.equal(bad.status, 400)
  assert.match(bad.json.error.message, /valid id, type, label/i)
  assert.deepEqual(store.sessionContexts(sid), [], 'no authorization binding committed')
  assert.deepEqual(store.sessionWorkspace(sid), EMPTY, 'no panel workspace committed')
})

test('malformed, unknown, and foreign-session transactions are refused', async () => {
  const sid = await session('wall')
  const malformed = await call('PATCH', `/sessions/${sid}/context-state`, { operations: [], workspace: { workspaces: [] } })
  assert.equal(malformed.status, 400)
  assert.match(malformed.json.error.message, /repos, connectors, and attachments/i)

  const ghost = await call('PATCH', '/sessions/ghost/context-state', { operations: [], workspace: EMPTY })
  assert.equal(ghost.status, 404)

  const foreign = await call(
    'PATCH',
    `/sessions/${sid}/context-state`,
    { operations: [], workspace: EMPTY },
    { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' },
  )
  assert.equal(foreign.status, 404)
})

test('malformed attachment payloads cannot commit a binding or reach a model', async () => {
  const sid = await session('invalid attachment boundary')
  for (const attachment of [null, { id: 'a', label: 42, kind: 'file' },
    { id: 'a', label: 'a.txt', kind: 'file', previewText: { secret: 'not text' } },
    { id: 'a', label: 'a.txt', kind: 'file', source: { kind: 'ui-host' } }]) {
    const result = await call('PATCH', `/sessions/${sid}/context-state`, {
      operations: [{ action: 'attach', context: { id: 'a', label: 'a.txt', type: 'files' } }],
      workspace: { ...EMPTY, attachments: [attachment] },
    })
    assert.equal(result.status, 400)
    assert.match(result.json.error.message, /attachments require valid/)
    assert.deepEqual(store.sessionContexts(sid), [])
    assert.deepEqual(store.sessionWorkspace(sid), EMPTY)
  }
})

test('resolveSessionContext finds an atomically attached context (the mediation lookup)', async () => {
  const sid = await session('mediation')
  await call('PATCH', `/sessions/${sid}/context-state`, {
    operations: [{ action: 'attach', context: { id: 'c-d', type: 'repo', label: 'D', scope: '~/d' } }],
    workspace: EMPTY,
  })
  assert.equal(store.resolveSessionContext(sid, 'c-d')?.scope, '~/d')
  assert.equal(store.resolveSessionContext(sid, 'absent'), undefined)
})

test('the three partial legacy mutation doors are retired', async () => {
  const sid = await session('one door')
  assert.equal((await call('POST', `/sessions/${sid}/contexts`, { id: 'x', type: 'folder', label: 'X' })).status, 0)
  assert.equal((await call('DELETE', `/sessions/${sid}/contexts/x`)).status, 0)
  assert.equal((await call('PATCH', `/sessions/${sid}/workspace`, EMPTY)).status, 0)
})
