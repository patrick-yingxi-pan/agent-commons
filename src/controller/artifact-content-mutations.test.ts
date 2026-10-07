import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ArtifactContentLibrary } from '../../contract/index.ts'
import { refreshAccount } from '../api/account.ts'
import { API_BASE } from '../api/client.ts'
import { keys, paths } from '../api/keys.ts'
import { resetAll, setData } from '../api/cache.ts'
import { artifactEditDrafts } from './artifactEditDrafts.ts'
import {
  discardArtifactContentMutation,
  retryArtifactContentMutation,
  updateArtifactBlock,
} from './artifactContentMutations.ts'

const artifactId = 'inline-stable-document-edit'
const owner = { userId: 'inline-edit-owner', tenantId: 'inline-edit-tenant' }
const body = (revision: number, blocks = [
  { id: 'first-block', p: 'first' },
  { id: 'stable-target', p: 'target' },
]): Extract<import('../../contract/index.ts').ArtifactContent, { type: 'doc' }> => ({
  type: 'doc', title: 'Editable note', revision, blocks,
})

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json', 'x-resolved-tenant': owner.tenantId },
  })
}

async function until(predicate: () => boolean): Promise<void> {
  for (let index = 0; index < 100 && !predicate(); index += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
  assert.equal(predicate(), true, 'expected the artifact mutation to reach the requested state')
}

function setup(): () => void {
  const originalFetch = globalThis.fetch
  refreshAccount(owner)
  setData<ArtifactContentLibrary>(keys.artifactContent, { [artifactId]: body(7) })
  return () => {
    globalThis.fetch = originalFetch
    refreshAccount(null)
    resetAll()
  }
}

test('inline draft dispatch sends stable block identity and its opening revision', async (t) => {
  const cleanup = setup()
  t.after(cleanup)
  const requests: Array<{ method?: string; url: string; body?: string; key?: string | null }> = []
  globalThis.fetch = async (input, init) => {
    requests.push({
      method: init?.method,
      url: String(input),
      body: init?.body as string | undefined,
      key: new Headers(init?.headers).get('Idempotency-Key'),
    })
    return json(body(8, [{ id: 'first-block', p: 'first' }, { id: 'stable-target', p: 'new text' }]))
  }

  artifactEditDrafts.start(artifactId, {
    kind: 'document', block: 1, blockId: 'stable-target', expectedRevision: 7, text: 'new text',
  })
  assert.equal(await artifactEditDrafts.save(artifactId), 'applied')
  assert.equal(requests.length, 1)
  assert.equal(requests[0]?.method, 'PATCH')
  assert.equal(requests[0]?.url, `${API_BASE}${paths.artifactContentEdit(artifactId)}`)
  assert.deepEqual(JSON.parse(requests[0]!.body!), {
    blockId: 'stable-target', text: 'new text', expectedRevision: 7,
  })
  assert.ok(requests[0]?.key, 'the stable edit still carries one logical idempotency key')
})

test('explicit Retry rebases only the revision; a reordered block remains addressed by its stable ID', async (t) => {
  const cleanup = setup()
  t.after(cleanup)
  const requests: Array<{ method?: string; body?: string }> = []
  let writes = 0
  globalThis.fetch = async (input, init) => {
    requests.push({ method: init?.method, body: init?.body as string | undefined })
    if (init?.method === 'PATCH' && ++writes === 1) return json({ error: { code: 'conflict', message: 'changed elsewhere' } }, 409)
    if (init?.method === 'GET') return json({ [artifactId]: body(8, [
      { id: 'stable-target', p: 'target moved to first position' },
      { id: 'first-block', p: 'first moved to second position' },
    ]) })
    return json(body(9, [
      { id: 'stable-target', p: 'reviewed replacement' },
      { id: 'first-block', p: 'first moved to second position' },
    ]))
  }

  const outcome = updateArtifactBlock(artifactId, 1, 'reviewed replacement', {
    blockId: 'stable-target', expectedRevision: 7,
  })
  await until(() => requests.some((request) => request.method === 'GET'))
  // Let the conflict handler finish reconciling and publish the held recovery state.
  await new Promise<void>((resolve) => setImmediate(resolve))
  retryArtifactContentMutation()
  assert.equal(await outcome, 'applied')

  const patches = requests.filter((request) => request.method === 'PATCH').map((request) => JSON.parse(request.body!))
  assert.deepEqual(patches, [
    { blockId: 'stable-target', text: 'reviewed replacement', expectedRevision: 7 },
    { blockId: 'stable-target', text: 'reviewed replacement', expectedRevision: 8 },
  ])
  assert.ok(patches.every((patch) => !Object.hasOwn(patch, 'block')),
    'a changed position never turns Retry into an index-based edit')
})

test('a deleted stable target stays deleted on Retry instead of falling through to its old index neighbor', async (t) => {
  const cleanup = setup()
  t.after(cleanup)
  const requests: Array<{ method?: string; body?: string }> = []
  let writes = 0
  globalThis.fetch = async (_input, init) => {
    requests.push({ method: init?.method, body: init?.body as string | undefined })
    if (init?.method === 'PATCH') {
      writes += 1
      return writes === 1
        ? json({ error: { code: 'conflict', message: 'changed elsewhere' } }, 409)
        : json({ error: { code: 'not_found', message: 'stable block no longer exists' } }, 404)
    }
    return json({ [artifactId]: body(8, [{ id: 'first-block', p: 'neighbor must not be changed' }]) })
  }

  const outcome = updateArtifactBlock(artifactId, 1, 'reviewed replacement', {
    blockId: 'stable-target', expectedRevision: 7,
  })
  await until(() => requests.some((request) => request.method === 'GET'))
  await new Promise<void>((resolve) => setImmediate(resolve))
  retryArtifactContentMutation()
  await until(() => requests.filter((request) => request.method === 'PATCH').length === 2)
  await new Promise<void>((resolve) => setImmediate(resolve))
  discardArtifactContentMutation()
  assert.equal(await outcome, 'discarded')

  const patches = requests.filter((request) => request.method === 'PATCH').map((request) => JSON.parse(request.body!))
  assert.deepEqual(patches, [
    { blockId: 'stable-target', text: 'reviewed replacement', expectedRevision: 7 },
    { blockId: 'stable-target', text: 'reviewed replacement', expectedRevision: 8 },
  ])
  assert.ok(patches.every((patch) => !Object.hasOwn(patch, 'block')),
    'a deleted target is never retargeted to the surviving ordinal neighbor')
})

test('legacy index-only callers remain compatible and partial stable locators fail closed', async (t) => {
  const cleanup = setup()
  t.after(cleanup)
  const requests: Array<{ method?: string; body?: string }> = []
  globalThis.fetch = async (_input, init) => {
    requests.push({ method: init?.method, body: init?.body as string | undefined })
    return json(body(8))
  }

  assert.equal(await updateArtifactBlock(artifactId, 1, 'legacy caller'), 'applied')
  assert.deepEqual(JSON.parse(requests[0]!.body!), {
    block: 1, text: 'legacy caller', expectedRevision: 7,
  })
  const before = requests.length
  artifactEditDrafts.start(artifactId, { kind: 'document', block: 1, blockId: 'stable-target', text: 'partial' })
  assert.equal(await artifactEditDrafts.save(artifactId), 'discarded')
  assert.equal(requests.length, before, 'missing opening revision cannot fall back to the mutable index')
})
