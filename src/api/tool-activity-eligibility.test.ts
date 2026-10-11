import assert from 'node:assert/strict'
import test from 'node:test'
import { readToolActivityEligibility } from './toolActivityEligibility.ts'
import { ApiRequestError } from './client.ts'

test('the eligibility parser accepts the complete bounded activity projection without a local 256-ID cap', async (t) => {
  const ids = Array.from({ length: 513 }, (_, index) => `activity-${index}`)
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({ decisionActivityIds: ids, confirmActivityIds: ids }))
  t.after(() => { globalThis.fetch = originalFetch })

  const result = await readToolActivityEligibility('session-a', null)
  assert.equal(result.decisionActivityIds.length, 513)
  assert.deepEqual(result.confirmActivityIds, ids)
})

test('the eligibility parser rejects duplicate IDs and confirmation outside the decision set', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })

  for (const payload of [
    { decisionActivityIds: ['a', 'a'], confirmActivityIds: [] },
    { decisionActivityIds: ['a'], confirmActivityIds: ['b'] },
  ]) {
    globalThis.fetch = async () => new Response(JSON.stringify(payload))
    await assert.rejects(readToolActivityEligibility('session-a', null), (error: unknown) =>
      error instanceof ApiRequestError && error.message === 'Invalid consent-control projection')
  }
})
