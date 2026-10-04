/** Public Artifact Trash and restore: strict owner CAS over HTTP and MCP. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ArtifactLifecycleSnapshot } from '../../contract/artifactLifecycle.ts'
import type { ServerEvent } from '../../contract/index.ts'
import { call } from '../testkit/http.ts'
import { buildRouter } from './index.ts'

const OWNER = 'tenant-personal'
const READER = 'tenant-beta'
const FOREIGN = 'tenant-growthworks'
const NESTED_READER = 'tenant-acme'
const cookieOf = (response: { headers: Record<string, string> }) => response.headers['set-cookie']?.split(';')[0] ?? ''

async function mcpTool(name: string, args: Record<string, unknown>, tenant: string) {
  const response = await call('POST', '/mcp', {
    jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args },
  }, { 'x-tenant-id': tenant })
  const result = response.json.result
  return JSON.parse(result.content[0].text) as { status: number; body: unknown }
}

async function stream(tenant: string) {
  let body = ''
  let status = 0
  let ended = false
  const callbacks = new Map<string, () => void>()
  const req = {
    method: 'GET', headers: { 'x-tenant-id': tenant },
    on(name: string, callback: () => void) { callbacks.set(name, callback); return req },
  }
  const res = {
    writeHead(value: number) { status = value; return res },
    setHeader() {}, flushHeaders() {}, on() {},
    write(chunk: unknown) { body += String(chunk); return true },
    end() { ended = true },
    get writableEnded() { return ended },
  }
  await buildRouter().handle(req as never, res as never, new URL('http://test/events'))
  assert.equal(status, 200)
  return {
    close: () => callbacks.get('close')?.(),
    events: (): ServerEvent[] => [...body.matchAll(/^data: (.+)$/gm)].flatMap((match) => {
      const event = JSON.parse(match[1])
      return event?.type ? [event] : []
    }),
  }
}

test('Artifact lifecycle HTTP/MCP routes enforce owner-only exact CAS and expose current lifecycle', async () => {
  const stamp = Date.now().toString(36)
  const created = await call('POST', '/artifacts', {
    name: `lifecycle-${stamp}.md`, kind: 'doc', body: 'Retained lifecycle body.',
  }, { 'x-tenant-id': OWNER, 'idempotency-key': `artifact-lifecycle-${stamp}` })
  assert.equal(created.status, 201)
  const id = created.json.artifact.id as string

  const initial = await call('GET', `/artifacts/${id}/lifecycle`, undefined, { 'x-tenant-id': OWNER })
  assert.equal(initial.status, 200)
  assert.deepEqual((initial.json as ArtifactLifecycleSnapshot).lifecycle, { state: 'active', revision: 0, changedAt: 0 })
  const initialTrash = await call('GET', '/artifacts/trash', undefined, { 'x-tenant-id': OWNER })
  assert.equal(initialTrash.status, 200)
  assert.equal(initialTrash.json.some((row: any) => row.artifact.id === id), false)
  for (const tenant of [READER, FOREIGN]) {
    assert.equal((await call('GET', `/artifacts/${id}/lifecycle`, undefined, { 'x-tenant-id': tenant })).status, 404)
    assert.equal((await call('PATCH', `/artifacts/${id}/lifecycle`, { state: 'trashed', expectedRevision: 0 }, { 'x-tenant-id': tenant })).status, 404)
    assert.deepEqual((await call('GET', '/artifacts/trash', undefined, { 'x-tenant-id': tenant })).json, [])
  }

  for (const body of [
    {}, { state: 'trashed' },
    { state: 'gone', expectedRevision: 0 }, { state: 'trashed', expectedRevision: -1 },
    { state: 'trashed', expectedRevision: Number.MAX_SAFE_INTEGER + 1 },
    { state: 'trashed', expectedRevision: 0, extra: true },
  ]) {
    assert.equal((await call('PATCH', `/artifacts/${id}/lifecycle`, body, { 'x-tenant-id': OWNER })).status, 400)
  }

  const trashed = await call('PATCH', `/artifacts/${id}/lifecycle`, { state: 'trashed', expectedRevision: 0 }, { 'x-tenant-id': OWNER })
  assert.equal(trashed.status, 200)
  assert.deepEqual((trashed.json as ArtifactLifecycleSnapshot).lifecycle, { state: 'trashed', revision: 1, changedAt: (trashed.json as ArtifactLifecycleSnapshot).lifecycle.changedAt })
  const listed = await call('GET', '/artifacts/trash', undefined, { 'x-tenant-id': OWNER })
  assert.equal(listed.status, 200)
  const trashedRow = listed.json.find((row: any) => row.artifact.id === id)
  assert.ok(trashedRow)
  assert.equal(trashedRow.trashedAt, (trashed.json as ArtifactLifecycleSnapshot).lifecycle.changedAt)
  assert.equal((await call('GET', `/artifacts/${id}`, undefined, { 'x-tenant-id': OWNER })).status, 404)

  const replay = await mcpTool('patch_artifacts_by_id_lifecycle', {
    id, body: { state: 'trashed', expectedRevision: 0 },
  }, OWNER)
  assert.equal(replay.status, 200)
  assert.deepEqual((replay.body as ArtifactLifecycleSnapshot).lifecycle, (trashed.json as ArtifactLifecycleSnapshot).lifecycle)
  assert.equal((await mcpTool('get_artifacts_trash', {}, OWNER)).status, 200)
  assert.equal((await mcpTool('get_artifacts_by_id_lifecycle', { id }, READER)).status, 404)

  const restored = await call('PATCH', `/artifacts/${id}/lifecycle`, { state: 'active', expectedRevision: 1 }, { 'x-tenant-id': OWNER })
  assert.equal(restored.status, 200)
  assert.equal((restored.json as ArtifactLifecycleSnapshot).lifecycle.state, 'active')
  assert.equal((restored.json as ArtifactLifecycleSnapshot).lifecycle.revision, 2)
  assert.equal((await call('GET', `/artifacts/${id}`, undefined, { 'x-tenant-id': OWNER })).status, 200)
  assert.equal((await call('PATCH', `/artifacts/${id}/lifecycle`, { state: 'active', expectedRevision: 0 }, { 'x-tenant-id': OWNER })).status, 409,
    'a stale first Trash retry cannot resurrect through restore')

  const trashedAgain = await call('PATCH', `/artifacts/${id}/lifecycle`, { state: 'trashed', expectedRevision: 2 }, { 'x-tenant-id': OWNER })
  assert.equal(trashedAgain.status, 200)
  assert.equal((await call('PATCH', `/artifacts/${id}/lifecycle`, { state: 'trashed', expectedRevision: 0 }, { 'x-tenant-id': OWNER })).status, 409,
    'only the immediately represented operation is an accepted retry')
})

test('lifecycle PATCH rejects a stale account source before an otherwise-authorized owner transition', async () => {
  const login = await call('POST', '/auth/login', {
    email: 'ada@acme.example', password: 'ada-demo-password',
  })
  assert.equal(login.status, 200)
  const cookie = cookieOf(login)
  const stamp = Date.now().toString(36)
  const created = await call('POST', '/artifacts', {
    name: `stale-source-lifecycle-${stamp}.md`, kind: 'doc', body: 'The caller owns this artifact.',
  }, { cookie, 'idempotency-key': `stale-source-lifecycle-${stamp}` })
  assert.equal(created.status, 201)
  const id = created.json.artifact.id as string

  const staleRead = await call('GET', `/artifacts/${id}/lifecycle`, undefined, {
    cookie, 'x-account-transition-source': 'session:user-maya',
  })
  assert.equal(staleRead.status, 409, 'account-bound reconciliation must not return same-tenant truth to stale intent')

  const stale = await call('PATCH', `/artifacts/${id}/lifecycle`, {
    state: 'trashed', expectedRevision: 0,
  }, { cookie, 'x-account-transition-source': 'session:user-maya' })
  assert.equal(stale.status, 409, 'a request issued by another account must not mutate through the current owner cookie')
  assert.equal(stale.json.error.code, 'conflict')
  const current = await call('GET', `/artifacts/${id}/lifecycle`, undefined, { cookie })
  assert.equal(current.status, 200)
  assert.deepEqual(current.json.lifecycle, { state: 'active', revision: 0, changedAt: 0 }, 'rejection does not advance persisted lifecycle state')
})

test('artifact lifecycle invalidation reaches nested readers losing access without identifying it to others', async () => {
  const stamp = Date.now().toString(36)
  const created = await call('POST', '/artifacts', {
    name: `nested-lifecycle-${stamp}.md`, kind: 'doc', body: 'Private root body.',
  }, { 'x-tenant-id': OWNER, 'idempotency-key': `nested-lifecycle-${stamp}` })
  assert.equal(created.status, 201)
  const id = created.json.artifact.id as string
  const rootGrant = await call('POST', '/grants', {
    subject: { kind: 'artifact', id }, audience: { kind: 'org', orgId: READER }, tier: 'comment',
  }, { 'x-tenant-id': OWNER })
  assert.equal(rootGrant.status, 200)
  const parent = await call('POST', '/discussions', {
    anchor: { ref: { kind: 'artifact', id } }, firstPost: 'Parent thread under the shared artifact.',
  }, { 'x-tenant-id': READER })
  assert.equal(parent.status, 200)
  const nested = await call('POST', '/discussions', {
    anchor: { ref: { kind: 'discussion', id: parent.json.id } },
    firstPost: 'Nested discussion with its own onward audience.',
  }, { 'x-tenant-id': READER })
  assert.equal(nested.status, 200)
  const nestedGrant = await call('POST', '/grants', {
    subject: { kind: 'discussion', id: parent.json.id },
    audience: { kind: 'org', orgId: NESTED_READER }, tier: 'view',
  }, { 'x-tenant-id': READER })
  assert.equal(nestedGrant.status, 200)
  const discussionId = nested.json.id as string
  const reader = { 'x-tenant-id': READER }
  const nestedReader = { 'x-tenant-id': NESTED_READER }
  assert.equal((await call('GET', `/artifacts/${id}`, undefined, nestedReader)).status, 404, 'nested reader has no root artifact access')
  assert.equal((await call('GET', `/discussions/${parent.json.id}`, undefined, nestedReader)).status, 404,
    'the parent discussion still inherits its artifact wall despite its own grant')
  assert.equal((await call('GET', `/discussions/${discussionId}`, undefined, nestedReader)).status, 200,
    'a descendant discussion can be read through its independently granted parent')

  const [ownerEvents, nestedReaderEvents, foreignEvents] = await Promise.all([stream(OWNER), stream(NESTED_READER), stream(FOREIGN)])
  try {
    const changed = await call('PATCH', `/artifacts/${id}/lifecycle`, { state: 'trashed', expectedRevision: 0 }, { 'x-tenant-id': OWNER })
    assert.equal(changed.status, 200)
    assert.equal((await call('GET', `/discussions/${discussionId}`, undefined, nestedReader)).status, 404)
    assert.ok(nestedReaderEvents.events().some((event) => event.type === 'social-access.changed' && event.tenantId === NESTED_READER),
      'the nested-only reader receives a tenant-targeted invalidation without learning the root identity')
    assert.equal(foreignEvents.events().some((event) => event.type === 'social-access.changed' && event.tenantId === NESTED_READER), false)
    for (const event of [...ownerEvents.events(), ...nestedReaderEvents.events(), ...foreignEvents.events()]) {
      if (event.type === 'artifact.changed') assert.deepEqual(Object.keys(event).sort(), ['artifactId', 'type'])
      if (event.type === 'social-access.changed') {
        assert.deepEqual(Object.keys(event).sort(), ['tenantId', 'type'])
        assert.equal(JSON.stringify(event).includes(id), false, 'a nested-only reader never receives the root artifact id')
      }
      assert.doesNotMatch(JSON.stringify(event), /Private root body|Parent thread|onward audience/)
    }

    const restored = await call('PATCH', `/artifacts/${id}/lifecycle`, { state: 'active', expectedRevision: 1 }, { 'x-tenant-id': OWNER })
    assert.equal(restored.status, 200)
    assert.ok(nestedReaderEvents.events().filter((event) => event.type === 'social-access.changed' && event.tenantId === NESTED_READER).length >= 2,
      'the same nested reader is invalidated when the rooted thread becomes readable again')
    assert.equal((await call('GET', `/discussions/${discussionId}`, undefined, nestedReader)).status, 200)
  } finally {
    ownerEvents.close(); nestedReaderEvents.close(); foreignEvents.close()
  }
})
