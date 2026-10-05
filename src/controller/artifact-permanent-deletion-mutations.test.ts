import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ArtifactDeletionPreview, ArtifactDeletionResult } from '../../contract/artifactDeletion.ts'
import type { ArtifactItem } from '../../contract/cowork.ts'
import type { ArtifactLifecycleSnapshot } from '../../contract/artifactLifecycle.ts'
import { activeAccount, refreshAccount } from '../api/account.ts'
import { keys } from '../api/keys.ts'
import { peek, resetAll } from '../api/cache.ts'
import { clearArtifactPermanentAbsences } from '../api/artifactPermanentAbsences.ts'
import {
  dismissArtifactPermanentDeletion,
  enqueueArtifactPermanentDeletion,
  heldArtifactPermanentDeletion,
  retryArtifactPermanentDeletion,
} from './artifactPermanentDeletionMutations.ts'

const artifact: ArtifactItem = {
  id: 'permanent-delete-controller-artifact', name: 'reviewed.md', kind: 'doc', meta: 'Notes',
  source: 'Conversation', projectId: '', editedAt: 1, own: true, lifecycleRevision: 1,
}
const preview: ArtifactDeletionPreview = {
  artifactId: artifact.id,
  artifactName: artifact.name,
  lifecycleRevision: 1,
  reviewToken: 'a'.repeat(64),
  counts: { versions: 2, shares: 1, discussions: 3, proposals: 4 },
}
const current: ArtifactLifecycleSnapshot = {
  artifact,
  lifecycle: { state: 'trashed', revision: 1, changedAt: 10 },
}
const receipt: ArtifactDeletionResult = { artifactId: artifact.id, deleted: true }
const response = (value: unknown, status = 200): Response => new Response(JSON.stringify(value), {
  status,
  headers: { 'content-type': 'application/json' },
})

async function until(predicate: () => boolean): Promise<void> {
  for (let index = 0; index < 100 && !predicate(); index += 1) await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(predicate(), true, 'expected controller work to reach the requested point')
}

test('permanent deletion freezes preview and row, coalesces, and retries with the same request identity', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch; clearArtifactPermanentAbsences(); resetAll() })
  let fetchCall = 0
  let reads = 0
  const writes: Array<{ body: string | null; key: string | null }> = []
  globalThis.fetch = async (_input, init) => {
    if (init?.method === 'DELETE') {
      writes.push({ body: init.body as string | null, key: new Headers(init.headers).get('Idempotency-Key') })
      fetchCall += 1
      if (fetchCall === 1) throw new Error('lost acknowledgement')
      return response(receipt)
    }
    reads += 1
    return response(current)
  }
  const reviewedRow = structuredClone(artifact)
  const reviewedPreview = structuredClone(preview)
  const result = enqueueArtifactPermanentDeletion(reviewedRow, reviewedPreview, 'user-ada')
  reviewedRow.name = 'changed after click.md'
  reviewedPreview.reviewToken = 'b'.repeat(64)
  const duplicate = enqueueArtifactPermanentDeletion({ ...artifact, name: 'later.md', lifecycleRevision: 3 }, { ...preview, lifecycleRevision: 3 }, 'user-maya')
  assert.equal(duplicate, result)
  await until(() => writes.length === 1)
  const held = heldArtifactPermanentDeletion(artifact.id)
  assert.equal(held?.artifact.name, 'reviewed.md')
  assert.equal(held?.preview.reviewToken, 'a'.repeat(64))
  await until(() => reads === 1)
  await new Promise<void>((resolve) => setImmediate(resolve))
  retryArtifactPermanentDeletion()
  assert.equal(await result, 'applied')
  assert.deepEqual(writes, [
    { body: JSON.stringify({ expectedLifecycleRevision: 1, reviewToken: 'a'.repeat(64) }), key: writes[0]?.key },
    { body: JSON.stringify({ expectedLifecycleRevision: 1, reviewToken: 'a'.repeat(64) }), key: writes[0]?.key },
  ])
  assert.ok(writes[0]?.key)
  assert.equal(heldArtifactPermanentDeletion(artifact.id), undefined)
})

test('Dismiss retains the destructive intent when lifecycle truth is unavailable', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch; clearArtifactPermanentAbsences(); resetAll() })
  let reads = 0
  globalThis.fetch = async (_input, init) => {
    if (init?.method === 'DELETE') throw new Error('connection lost')
    reads += 1
    return response({ error: { code: 'internal', message: 'temporary outage' } }, 503)
  }
  let settled = false
  const result = enqueueArtifactPermanentDeletion(artifact, preview, null).then((outcome) => { settled = true; return outcome })
  await until(() => reads === 1)
  await new Promise<void>((resolve) => setImmediate(resolve))
  dismissArtifactPermanentDeletion()
  await until(() => reads === 2)
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.ok(heldArtifactPermanentDeletion(artifact.id))
  assert.equal(settled, false)

  globalThis.fetch = async () => response({ error: { code: 'not_found', message: 'gone' } }, 404)
  dismissArtifactPermanentDeletion()
  assert.equal(await result, 'applied', 'authoritative 404 proves the delete landed')
  assert.equal(heldArtifactPermanentDeletion(artifact.id), undefined)
})

test('account switching clears held deletion and fences its late acknowledgement', async (t) => {
  const originalFetch = globalThis.fetch
  const originalAccount = activeAccount()
  let started!: () => void
  let respond!: (value: Response) => void
  const requestStarted = new Promise<void>((resolve) => { started = resolve })
  const delayedResponse = new Promise<Response>((resolve) => { respond = resolve })
  t.after(() => {
    globalThis.fetch = originalFetch
    refreshAccount(originalAccount)
    clearArtifactPermanentAbsences()
    resetAll()
  })
  globalThis.fetch = async (_input, init) => {
    if (init?.method === 'DELETE') { started(); return delayedResponse }
    return response(current)
  }

  const result = enqueueArtifactPermanentDeletion(artifact, preview, null)
  await requestStarted
  assert.ok(heldArtifactPermanentDeletion(artifact.id))
  refreshAccount({ userId: 'other-user', tenantId: 'other-tenant' })
  assert.equal(heldArtifactPermanentDeletion(artifact.id), undefined)
  assert.equal(await result, 'discarded')
  respond(response(receipt))
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(heldArtifactPermanentDeletion(artifact.id), undefined)
  assert.equal(peek(keys.artifactLifecycle(artifact.id)), undefined)
})

test('stale preview is sent unchanged and remains a conflict instead of rebasing after a restore cycle', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch; clearArtifactPermanentAbsences(); resetAll() })
  const writes: Array<{ body: string | null; key: string | null }> = []
  const laterTrash: ArtifactLifecycleSnapshot = {
    artifact: { ...artifact, lifecycleRevision: 3 },
    lifecycle: { state: 'trashed', revision: 3, changedAt: 30 },
  }
  let reads = 0
  globalThis.fetch = async (_input, init) => {
    if (init?.method === 'DELETE') {
      writes.push({ body: init.body as string | null, key: new Headers(init.headers).get('Idempotency-Key') })
      return response({ error: { code: 'conflict', message: 'stale review' } }, 409)
    }
    reads += 1
    return response(laterTrash)
  }
  const result = enqueueArtifactPermanentDeletion(artifact, preview, 'user-ada')
  await until(() => reads === 1)
  assert.equal(writes.length, 1)
  assert.equal(writes[0]?.body, JSON.stringify({ expectedLifecycleRevision: 1, reviewToken: preview.reviewToken }))
  assert.ok(writes[0]?.key)
  await new Promise<void>((resolve) => setImmediate(resolve))
  dismissArtifactPermanentDeletion()
  await until(() => reads === 2)
  assert.equal(await result, 'discarded')
  assert.equal(heldArtifactPermanentDeletion(artifact.id), undefined)
})
