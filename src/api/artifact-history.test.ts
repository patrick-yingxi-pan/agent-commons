import assert from 'node:assert/strict'
import { test } from 'node:test'
import { refreshAccount } from './account.ts'
import { API_BASE } from './client.ts'
import { keys, paths } from './keys.ts'
import { peek, resetAll } from './cache.ts'
import type { ArtifactContentLibrary } from '../../contract/content.ts'
import { readArtifactHistory, restoreArtifactHistoryVersion } from './artifactHistory.ts'

const body = { type: 'doc', title: 'Notes', blocks: [{ p: 'restored text' }] }
const restoreReceipt = {
  artifactId: 'history-api-artifact',
  currentRevision: 3,
  version: {
    revision: 2,
    savedAt: '2026-10-05T12:00:00.000Z',
    reason: 'restore',
    restoredFromRevision: 0,
    body,
  },
}
const response = (value: unknown): Response => new Response(JSON.stringify(value), {
  status: 200,
  headers: { 'content-type': 'application/json', 'x-resolved-tenant': 'history-api-tenant' },
})

test('history reads use the bounded metadata path and restore validates the new-version receipt', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch; refreshAccount(null); resetAll() })
  refreshAccount({ userId: 'history-api-user', tenantId: 'history-api-tenant' })
  const calls: Array<{ url: string; method?: string; body?: string; key?: string | null; source?: string | null }> = []
  globalThis.fetch = async (input, init) => {
    calls.push({
      url: String(input),
      method: init?.method,
      body: init?.body as string | undefined,
      key: new Headers(init?.headers).get('Idempotency-Key'),
      source: new Headers(init?.headers).get('X-Account-Transition-Source'),
    })
    if (init?.method === 'POST') return response(restoreReceipt)
    return response({ artifactId: 'history-api-artifact', currentRevision: 1, versions: [
      { revision: 1, savedAt: '2026-10-05T11:00:00.000Z', reason: 'edit' },
      { revision: 0, savedAt: null, reason: 'baseline' },
    ] })
  }

  const page = await readArtifactHistory('history-api-artifact')
  assert.equal(page.currentRevision, 1)
  assert.equal(calls[0]?.url, `${API_BASE}${paths.artifactHistory('history-api-artifact')}`)

  const result = await restoreArtifactHistoryVersion('history-api-artifact', 0, { expectedRevision: 1 }, 'history-restore-key', 'history-api-user')
  assert.equal(result.version.revision, 2, 'restore receipt is the newly appended version, not its source revision')
  assert.equal(result.currentRevision, 3, 'a replay may describe a restore receipt older than current truth')
  assert.equal(calls[1]?.url, `${API_BASE}${paths.artifactHistoryRestore('history-api-artifact', 0)}`)
  assert.equal(calls[1]?.method, 'POST')
  assert.equal(calls[1]?.body, JSON.stringify({ expectedRevision: 1 }))
  assert.equal(calls[1]?.key, 'history-restore-key')
  assert.equal(calls[1]?.source, 'session:history-api-user')
  assert.equal(peek<ArtifactContentLibrary>(keys.artifactContent), undefined, 'history receipt never merges its possibly old body into current cache')
})
