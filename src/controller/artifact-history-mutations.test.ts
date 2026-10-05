import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ArtifactContentLibrary, ArtifactItem } from '../../contract/index.ts'
import { refreshAccount } from '../api/account.ts'
import { API_BASE } from '../api/client.ts'
import { keys, paths } from '../api/keys.ts'
import { peek, resetAll, setData } from '../api/cache.ts'
import {
  dismissArtifactHistoryRestore,
  enqueueArtifactHistoryRestore,
  heldArtifactHistoryRestore,
  retryArtifactHistoryRestore,
} from './artifactHistoryMutations.ts'
import { isArtifactHistoryRestoreHeld } from './artifactBodyOperationHolds.ts'
import { artifactEditDrafts } from './artifactEditDrafts.ts'
import { enqueueArtifactLifecycle } from './artifactLifecycleMutations.ts'

const item: ArtifactItem = {
  id: 'history-mutation-artifact', name: 'notes.md', kind: 'doc', meta: 'Notes',
  source: 'Conversation', projectId: '', editedAt: 1, own: true,
}
const before = { type: 'doc', title: 'Notes', blocks: [{ p: 'current text' }], revision: 1 } as const
const restoredBody = { type: 'doc', title: 'Notes', blocks: [{ p: 'old text' }] }
const page = (currentRevision: number, versions = [
  { revision: 1, savedAt: '2026-10-05T11:00:00.000Z', reason: 'edit' as const },
  { revision: 0, savedAt: null, reason: 'baseline' as const },
]) => ({ artifactId: item.id, currentRevision, versions })
const receipt = {
  artifactId: item.id,
  currentRevision: 2,
  version: { revision: 2, savedAt: '2026-10-05T12:00:00.000Z', reason: 'restore', restoredFromRevision: 0, body: restoredBody },
}
const response = (value: unknown, status = 200): Response => new Response(JSON.stringify(value), {
  status,
  headers: { 'content-type': 'application/json', 'x-resolved-tenant': 'history-controller-tenant' },
})

function seed(): void {
  setData<ArtifactContentLibrary>(keys.artifactContent, { [item.id]: before })
}

async function until(predicate: () => boolean): Promise<void> {
  for (let index = 0; index < 100 && !predicate(); index += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
  assert.equal(predicate(), true, 'expected history operation to reach the requested state')
}

test('restore retry preserves the reviewed target, expected revision, principal and idempotency key', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch; refreshAccount(null); resetAll() })
  refreshAccount({ userId: 'history-controller-user', tenantId: 'history-controller-tenant' })
  seed()
  const calls: Array<{ method?: string; url: string; body?: string; key?: string | null; source?: string | null }> = []
  globalThis.fetch = async (input, init) => {
    calls.push({
      method: init?.method,
      url: String(input),
      body: init?.body as string | undefined,
      key: new Headers(init?.headers).get('Idempotency-Key'),
      source: new Headers(init?.headers).get('X-Account-Transition-Source'),
    })
    if (init?.method === 'POST') {
      if (calls.filter((call) => call.method === 'POST').length === 1) throw new Error('response lost')
      return response(receipt)
    }
    if (String(input).includes('/history?')) return response(page(1))
    return response({ [item.id]: before })
  }

  const pending = enqueueArtifactHistoryRestore(item.id, 0, 1, 'history-controller-user')
  await until(() => calls.filter((call) => call.method === 'GET').length === 2)
  assert.equal(heldArtifactHistoryRestore(item.id)?.targetRevision, 0)
  assert.equal(heldArtifactHistoryRestore(item.id)?.expectedRevision, 1)
  assert.equal(isArtifactHistoryRestoreHeld(item.id), true)
  artifactEditDrafts.start(item.id, { kind: 'document', block: 0, text: 'competing edit' })
  assert.equal(artifactEditDrafts.get(item.id), undefined, 'a history restore blocks a concurrent body draft')
  assert.equal(await enqueueArtifactLifecycle(item, 'trashed', 'history-controller-user'), 'discarded', 'Trash cannot race the held restore')

  retryArtifactHistoryRestore()
  assert.equal(await pending, 'applied')
  const posts = calls.filter((call) => call.method === 'POST')
  assert.equal(posts.length, 2)
  assert.deepEqual(posts.map((call) => call.body), [
    JSON.stringify({ expectedRevision: 1 }), JSON.stringify({ expectedRevision: 1 }),
  ])
  assert.equal(posts[0]?.url, `${API_BASE}${paths.artifactHistoryRestore(item.id, 0)}`)
  assert.equal(posts[0]?.key, posts[1]?.key)
  assert.ok(posts.every((call) => call.source === 'session:history-controller-user'))
  assert.equal(peek<ArtifactContentLibrary>(keys.artifactContent)?.[item.id]?.revision, 2)
  assert.equal(heldArtifactHistoryRestore(item.id), undefined)
  assert.equal(isArtifactHistoryRestoreHeld(item.id), false)
})

test('Dismiss reads current history/body but never replays restore, and metadata resemblance does not settle it', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch; refreshAccount(null); resetAll() })
  refreshAccount({ userId: 'history-controller-user', tenantId: 'history-controller-tenant' })
  seed()
  const calls: Array<{ method?: string; url: string }> = []
  const lookalike = page(2, [
    { revision: 2, savedAt: '2026-10-05T12:00:00.000Z', reason: 'restore', restoredFromRevision: 0 },
    { revision: 1, savedAt: '2026-10-05T11:00:00.000Z', reason: 'edit' },
    { revision: 0, savedAt: null, reason: 'baseline' },
  ])
  globalThis.fetch = async (input, init) => {
    calls.push({ method: init?.method, url: String(input) })
    if (init?.method === 'POST') throw new Error('connection lost')
    if (String(input).includes('/history?')) return response(lookalike)
    return response({ [item.id]: { ...before, revision: 2 } })
  }

  let settled = false
  const pending = enqueueArtifactHistoryRestore(item.id, 0, 1, 'history-controller-user').then((outcome) => {
    settled = true
    return outcome
  })
  await until(() => calls.filter((call) => call.method === 'GET').length === 2)
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(settled, false, 'a history row that resembles the expected restore is not a durable receipt')
  assert.ok(heldArtifactHistoryRestore(item.id))
  dismissArtifactHistoryRestore()
  assert.equal(await pending, 'discarded')
  assert.equal(calls.filter((call) => call.method === 'POST').length, 1, 'Dismiss must not replay a potentially first-time restore')
  assert.equal(calls.filter((call) => call.method === 'GET').length, 4, 'Dismiss performs read-only reconciliation')
  assert.equal(heldArtifactHistoryRestore(item.id), undefined)
})

test('account switch clears the hold and fences a delayed restore acknowledgement', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch; refreshAccount(null); resetAll() })
  refreshAccount({ userId: 'history-controller-user', tenantId: 'history-controller-tenant' })
  seed()
  let markStarted!: () => void
  let resolveFetch!: (response: Response) => void
  const started = new Promise<void>((resolve) => { markStarted = resolve })
  const delayed = new Promise<Response>((resolve) => { resolveFetch = resolve })
  globalThis.fetch = async () => { markStarted(); return delayed }

  const pending = enqueueArtifactHistoryRestore(item.id, 0, 1, 'history-controller-user')
  await started
  refreshAccount({ userId: 'history-controller-other', tenantId: 'history-controller-other-tenant' })
  assert.equal(await pending, 'discarded')
  assert.equal(heldArtifactHistoryRestore(item.id), undefined)
  assert.equal(isArtifactHistoryRestoreHeld(item.id), false)
  resolveFetch(response({ ...receipt, version: { ...receipt.version, revision: 2 } }))
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(peek<ArtifactContentLibrary>(keys.artifactContent)?.[item.id]?.revision, 1, 'late old-account body never reaches cache')
})

test('a replay receipt older than current truth refreshes current content instead of merging its historical body', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch; refreshAccount(null); resetAll() })
  refreshAccount({ userId: 'history-controller-user', tenantId: 'history-controller-tenant' })
  seed()
  const latest = { type: 'doc', title: 'Notes', blocks: [{ p: 'later edit' }], revision: 3 } as const
  const calls: string[] = []
  globalThis.fetch = async (input, init) => {
    calls.push(`${init?.method}:${String(input)}`)
    if (init?.method === 'POST') return response({ ...receipt, currentRevision: 3 })
    if (String(input).includes('/history?')) return response(page(3, [
      { revision: 3, savedAt: '2026-10-05T13:00:00.000Z', reason: 'edit' },
      { revision: 2, savedAt: '2026-10-05T12:00:00.000Z', reason: 'restore', restoredFromRevision: 0 },
      { revision: 1, savedAt: '2026-10-05T11:00:00.000Z', reason: 'edit' },
      { revision: 0, savedAt: null, reason: 'baseline' },
    ]))
    return response({ [item.id]: latest })
  }

  const outcome = await enqueueArtifactHistoryRestore(item.id, 0, 1, 'history-controller-user')
  assert.equal(outcome, 'applied')
  assert.deepEqual(peek<ArtifactContentLibrary>(keys.artifactContent)?.[item.id], latest)
  assert.ok(calls.some((call) => call === `GET:${API_BASE}${paths.artifactContent}`), 'a delayed receipt reconciles present content')
  assert.notDeepEqual(peek<ArtifactContentLibrary>(keys.artifactContent)?.[item.id], receipt.version.body)
})

test('read-only Dismiss retains an uncertain restore when reconciliation fails, then releases after reads succeed', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch; refreshAccount(null); resetAll() })
  refreshAccount({ userId: 'history-controller-user', tenantId: 'history-controller-tenant' })
  seed()
  let historyReads = 0
  let bodyReads = 0
  const calls: string[] = []
  globalThis.fetch = async (input, init) => {
    calls.push(`${init?.method}:${String(input)}`)
    if (init?.method === 'POST') throw new Error('connection lost')
    if (String(input).includes('/history?')) {
      historyReads += 1
      return response(page(1))
    }
    bodyReads += 1
    if (bodyReads <= 2) return response({ error: { code: 'internal', message: 'temporary read failure' } }, 503)
    return response({ [item.id]: before })
  }

  let settled = false
  const pending = enqueueArtifactHistoryRestore(item.id, 0, 1, 'history-controller-user').then((outcome) => {
    settled = true
    return outcome
  })
  await until(() => bodyReads === 1)
  await new Promise<void>((resolve) => setImmediate(resolve))
  dismissArtifactHistoryRestore()
  await until(() => bodyReads === 2)
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(settled, false, 'a failed authoritative read cannot release a possibly committed body operation')
  assert.ok(heldArtifactHistoryRestore(item.id))
  dismissArtifactHistoryRestore()
  assert.equal(await pending, 'discarded')
  assert.equal(historyReads, 3)
  assert.equal(bodyReads, 3)
  assert.equal(calls.filter((call) => call.startsWith('POST:')).length, 1)
})

test('read-only Dismiss can release a trashed artifact after history succeeds while current body is absent', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch; refreshAccount(null); resetAll() })
  refreshAccount({ userId: 'history-controller-user', tenantId: 'history-controller-tenant' })
  seed()
  const calls: string[] = []
  globalThis.fetch = async (input, init) => {
    calls.push(`${init?.method}:${String(input)}`)
    if (init?.method === 'POST') throw new Error('connection lost')
    if (String(input).includes('/history?')) return response(page(1))
    return response({}, 200)
  }

  const pending = enqueueArtifactHistoryRestore(item.id, 0, 1, 'history-controller-user')
  await until(() => calls.filter((call) => call.includes('/history?')).length === 1)
  await new Promise<void>((resolve) => setImmediate(resolve))
  dismissArtifactHistoryRestore()
  assert.equal(await pending, 'discarded')
  assert.equal(calls.filter((call) => call.startsWith('POST:')).length, 1)
  assert.equal(calls.filter((call) => call.includes('/history?')).length, 2)
  assert.equal(heldArtifactHistoryRestore(item.id), undefined)
})
