import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ArtifactItem } from '../../contract/cowork.ts'
import type { ArtifactLifecycleSnapshot } from '../../contract/artifactLifecycle.ts'
import { activeAccount, refreshAccount } from '../api/account.ts'
import { keys } from '../api/keys.ts'
import { peek, resetAll, setData } from '../api/cache.ts'
import {
  discardArtifactLifecycle,
  enqueueArtifactLifecycle,
  heldArtifactLifecycle,
  retryArtifactLifecycle,
} from './artifactLifecycleMutations.ts'

const artifact: ArtifactItem = {
  id: 'lifecycle-controller-artifact', name: 'notes.md', kind: 'doc', meta: 'Notes',
  source: 'Conversation', projectId: '', editedAt: 1, own: true,
}
const baseline: ArtifactLifecycleSnapshot = {
  artifact,
  lifecycle: { state: 'active', revision: 0, changedAt: 0 },
}
const acknowledgement: ArtifactLifecycleSnapshot = {
  artifact,
  lifecycle: { state: 'trashed', revision: 1, changedAt: 10 },
}
const response = (value: unknown): Response => new Response(JSON.stringify(value), {
  status: 200,
  headers: { 'content-type': 'application/json' },
})

async function until(predicate: () => boolean): Promise<void> {
  for (let index = 0; index < 100 && !predicate(); index += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
  assert.equal(predicate(), true, 'expected controller work to reach the requested point')
}

test('artifact lifecycle retry retains the reviewed revision and one logical key', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch; resetAll() })
  setData(keys.artifactLifecycle(artifact.id), baseline)
  const calls: Array<{ method?: string; body?: string | null; key?: string | null; source?: string | null }> = []
  globalThis.fetch = async (_input, init) => {
    calls.push({
      method: init?.method,
      body: init?.body as string | null | undefined,
      key: new Headers(init?.headers).get('Idempotency-Key'),
      source: new Headers(init?.headers).get('X-Account-Transition-Source'),
    })
    if (init?.method === 'PATCH' && calls.filter((call) => call.method === 'PATCH').length === 1) {
      throw new Error('connection lost after request')
    }
    if (init?.method === 'PATCH') return response(acknowledgement)
    return response(baseline)
  }

  const first = enqueueArtifactLifecycle(artifact, 'trashed', 'user-ada')
  const coalesced = enqueueArtifactLifecycle(artifact, 'active', 'user-maya', 99)
  assert.equal(coalesced, first, 'a second activation for this artifact joins the held action')
  await until(() => calls.length >= 2)
  const held = heldArtifactLifecycle(artifact.id)
  assert.equal(held?.expectedRevision, 0)
  assert.equal(held?.sourceUserId, 'user-ada')
  assert.deepEqual(held?.artifact, artifact)
  retryArtifactLifecycle()
  assert.equal(await first, 'applied')

  const writes = calls.filter((call) => call.method === 'PATCH')
  assert.equal(writes.length, 2)
  assert.deepEqual(writes.map((call) => call.body), [
    JSON.stringify({ state: 'trashed', expectedRevision: 0 }),
    JSON.stringify({ state: 'trashed', expectedRevision: 0 }),
  ])
  assert.equal(writes[0]?.key, writes[1]?.key, 'Retry reuses the original idempotency key')
  assert.ok(calls.every((call) => call.source === 'session:user-ada'), 'Retry and reconciliation retain the initiating account')
  assert.equal(heldArtifactLifecycle(artifact.id), undefined)
})

test('Dismiss retains the artifact intent when its authoritative read fails, then releases after a successful read', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch; resetAll() })
  setData(keys.artifactLifecycle(artifact.id), baseline)
  let reads = 0
  globalThis.fetch = async (_input, init) => {
    if (init?.method === 'PATCH') throw new Error('connection lost')
    reads += 1
    if (reads <= 2) return new Response(JSON.stringify({ error: { code: 'internal', message: 'temporary read failure' } }), { status: 503 })
    return response(baseline)
  }

  let settled = false
  const result = enqueueArtifactLifecycle(artifact, 'trashed', null).then((outcome) => {
    settled = true
    return outcome
  })
  await until(() => reads === 1)
  discardArtifactLifecycle()
  await until(() => reads === 2)
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.ok(heldArtifactLifecycle(artifact.id), 'the full reviewed row remains available for recovery')
  assert.equal(settled, false, 'the caller is not told Dismiss completed before truth was read')

  discardArtifactLifecycle()
  assert.equal(await result, 'discarded')
  assert.equal(heldArtifactLifecycle(artifact.id), undefined)
})

test('account switching clears the held row and fences a late lifecycle acknowledgement', async (t) => {
  const originalFetch = globalThis.fetch
  const originalAccount = activeAccount()
  let started!: () => void
  let respond!: (value: Response) => void
  const requestStarted = new Promise<void>((resolve) => { started = resolve })
  const delayedResponse = new Promise<Response>((resolve) => { respond = resolve })
  t.after(() => {
    globalThis.fetch = originalFetch
    refreshAccount(originalAccount)
    resetAll()
  })
  globalThis.fetch = async () => {
    started()
    return delayedResponse
  }

  const result = enqueueArtifactLifecycle(artifact, 'trashed', null)
  await requestStarted
  assert.ok(heldArtifactLifecycle(artifact.id))
  refreshAccount({ userId: 'different-user', tenantId: 'different-tenant' })
  assert.equal(heldArtifactLifecycle(artifact.id), undefined)
  assert.equal(await result, 'discarded')

  respond(response(acknowledgement))
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(heldArtifactLifecycle(artifact.id), undefined)
  assert.equal(peek(keys.artifactLifecycle(artifact.id)), undefined, 'late prior-account response cannot publish lifecycle truth')
})

test('a settled FIFO head releases its row while the next artifact remains held', async (t) => {
  const originalFetch = globalThis.fetch
  const secondArtifact: ArtifactItem = { ...artifact, id: 'lifecycle-controller-second' }
  const secondAck: ArtifactLifecycleSnapshot = {
    artifact: secondArtifact,
    lifecycle: { state: 'trashed', revision: 1, changedAt: 20 },
  }
  let started!: () => void
  let respond!: (value: Response) => void
  const secondStarted = new Promise<void>((resolve) => { started = resolve })
  const delayedSecond = new Promise<Response>((resolve) => { respond = resolve })
  t.after(() => { globalThis.fetch = originalFetch; resetAll() })
  globalThis.fetch = async (input) => String(input).includes(secondArtifact.id)
    ? (started(), delayedSecond)
    : response(acknowledgement)

  const first = enqueueArtifactLifecycle(artifact, 'trashed', null)
  const second = enqueueArtifactLifecycle(secondArtifact, 'trashed', null)
  await first
  await secondStarted
  assert.equal(heldArtifactLifecycle(artifact.id), undefined)
  assert.ok(heldArtifactLifecycle(secondArtifact.id), 'the second queue entry keeps only its own reviewed row held')
  respond(response(secondAck))
  assert.equal(await second, 'applied')
  assert.equal(heldArtifactLifecycle(secondArtifact.id), undefined)
})
