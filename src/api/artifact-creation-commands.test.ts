import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { ArtifactItem, CreateArtifactRequest, RelationGraph } from '../../contract/index.ts'
import { refreshAccount } from './account.ts'
import { AccountSwitchedError } from './client.ts'
import { applyArtifactCreation, reconcileArtifactCreation, rememberCreatedArtifact, type ArtifactCreationIntent } from './artifactCreationCommands.ts'
import { artifactCreationId } from './artifactCreationIdentity.ts'
import { peek, setData } from './cache.ts'
import { keys } from './keys.ts'

const tenantId = 'tenant-artifact-command'
const request: CreateArtifactRequest = { name: 'launch.sheet', kind: 'sheet', body: { type: 'sheet', columns: ['Metric'], rows: [['42']] }, projectId: null }
const intent = (intentId = 'artifact-command-intent'): ArtifactCreationIntent => ({ tenantId, sourceUserId: 'user-artifact-command', intentId, request })
const row = (id: string, extra: Partial<ArtifactItem> = {}): ArtifactItem => ({
  id, name: request.name, kind: 'sheet', meta: 'Sheet', source: 'Created here', projectId: '', editedAt: 10, own: true, tenantId, ...extra,
})
const graph = (artifact: ArtifactItem, revision = 2): RelationGraph => ({
  revision,
  sessionProject: {}, artifactProject: {}, scheduleProject: {}, projectContexts: {}, projectInstructions: {}, projectDescriptions: {},
  artifactSource: {}, scheduleArtifact: {}, scheduleSession: {}, scheduleExtraTools: {}, extraArtifacts: [artifact], extraProjects: [], standingApprovals: {},
})
const jsonResponse = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { 'Content-Type': 'application/json', 'x-resolved-tenant': tenantId },
})

test('creation POST retains one key and accepts only its exact owned derived row', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch; refreshAccount(null) })
  refreshAccount({ userId: 'user-artifact-command', tenantId })
  setData<ArtifactItem[]>(keys.artifacts, [])
  const key = 'artifact-command-create-once'
  const expectedId = await artifactCreationId(tenantId, key)
  const artifact = row(expectedId)
  const calls: Array<{ url: string; method: string; key: string | null; source: string | null; body: unknown }> = []
  globalThis.fetch = async (input, init) => {
    calls.push({
      url: String(input), method: init?.method ?? 'GET',
      key: new Headers(init?.headers).get('Idempotency-Key'),
      source: new Headers(init?.headers).get('X-Account-Transition-Source'),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    })
    return jsonResponse({ artifact, graph: graph(artifact) }, 201)
  }

  await applyArtifactCreation(intent(), key)
  assert.deepEqual(calls, [{ url: '/api/v1/artifacts', method: 'POST', key, source: 'session:user-artifact-command', body: request }])
  assert.equal(peek<ArtifactItem[]>(keys.artifacts)?.[0]?.id, expectedId)
  assert.equal(peek<RelationGraph>(keys.relations)?.revision, 2)

  for (const invalid of [row('artifact-new-' + 'f'.repeat(24)), row(expectedId, { own: false })]) {
    globalThis.fetch = async () => jsonResponse({ artifact: invalid, graph: graph(invalid) }, 201)
    await assert.rejects(applyArtifactCreation(intent(), key), /Unexpected artifact creation identity/)
  }
})

test('recovery reads only the derived row and requires exact owned truth', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch; refreshAccount(null) })
  refreshAccount({ userId: 'user-artifact-reconcile', tenantId })
  const key = 'artifact-command-reconcile'
  const expectedId = await artifactCreationId(tenantId, key)
  const seen: string[] = []
  for (const [candidate, expected] of [
    [row(expectedId), true],
    [row('artifact-new-' + 'e'.repeat(24)), false],
    [row(expectedId, { own: false }), false],
  ] as const) {
    globalThis.fetch = async (input) => { seen.push(String(input)); return jsonResponse(candidate) }
    assert.equal(await reconcileArtifactCreation(intent(), key), expected)
  }
  globalThis.fetch = async (input) => {
    seen.push(String(input))
    return jsonResponse({ error: { code: 'not_found', message: 'No such artifact' } }, 404)
  }
  assert.equal(await reconcileArtifactCreation(intent(), key), false)
  assert.deepEqual(seen, Array(4).fill(`/api/v1/artifacts/${expectedId}`))
})

test('creation acknowledgement never replaces a newer cached row with the same exact id', async () => {
  const id = 'artifact-new-' + 'a'.repeat(24)
  const newer = row(id, { name: 'renamed-after-create.sheet', metadataRevision: 4, editedAt: 90, excerpt: 'newer content' })
  setData<ArtifactItem[]>(keys.artifacts, [newer])
  rememberCreatedArtifact(row(id, { metadataRevision: 0, editedAt: 10, excerpt: 'stale create response' }))
  assert.deepEqual(peek<ArtifactItem[]>(keys.artifacts), [newer])
})

test('an account switch while asynchronous identity hashing is pending prevents the POST', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch; refreshAccount(null) })
  refreshAccount({ userId: 'user-artifact-old', tenantId })
  let calls = 0
  globalThis.fetch = async () => { calls += 1; throw new Error('must not send') }
  const applying = applyArtifactCreation(intent('switch-during-hash'), 'switch-during-hash')
  refreshAccount({ userId: 'user-artifact-new', tenantId: 'tenant-artifact-new' })
  await assert.rejects(applying, (error: unknown) => error instanceof AccountSwitchedError)
  assert.equal(calls, 0)
})
