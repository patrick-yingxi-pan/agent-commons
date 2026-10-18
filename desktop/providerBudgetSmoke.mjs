/** Excluded acceptance helper. Policy writes use the authenticated public API;
 * native SQLite observers remain strictly read-only. */
import assert from 'node:assert/strict'

const WINDOW = '5-hour limit'

export async function patchProviderSmokeCeiling(page, providerId, ceiling) {
  assert.ok(Number.isSafeInteger(ceiling) && ceiling >= 0)
  const path = `/api/v1/providers/${encodeURIComponent(providerId)}`
  const result = await page.evaluate(async ({ path, ceiling, window }) => {
    const current = await fetch(path)
    if (current.status !== 200) return { readStatus: current.status }
    const provider = await current.json()
    const windows = provider.plan?.windows ?? []
    const plan = { windows: [
      ...windows.filter(row => row.label !== window), { label: window, ceiling },
    ] }
    const response = await fetch(path, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
      body: JSON.stringify({ expectedRevision: provider.definitionRevision ?? 0, plan }),
    })
    return { readStatus: current.status, status: response.status, provider: await response.json(),
      previousRevision: provider.definitionRevision ?? 0, plan }
  }, { path, ceiling, window: WINDOW })
  assert.equal(result.readStatus, 200, 'budget setup reads the exact authenticated provider')
  assert.equal(result.status, 200, 'the revision-pinned public provider plan write succeeds')
  assert.equal(result.provider.id, providerId)
  assert.equal(result.provider.definitionRevision, result.previousRevision + 1)
  assert.deepEqual(result.provider.plan, result.plan)
  return result.provider
}

export function assertProviderSmokeBudget(state, savedProvider) {
  assert.equal(state.provider.id, savedProvider.id)
  assert.equal(state.provider.definitionRevision, savedProvider.definitionRevision)
  assert.deepEqual(state.provider.plan, savedProvider.plan, 'the narrowed provider plan survives native SQLite relaunch')
}

export function assertProviderSmokeBudgetRefusal(response, before, after, requestsBefore, requestsAfter) {
  assert.equal(response.status, 429, 'the packaged backend refuses the inherited exhausted provider plan')
  assert.equal(response.body?.error?.code, 'limit_exceeded')
  assert.equal(requestsAfter, requestsBefore, 'budget refusal never crosses the provider boundary')
  assert.deepEqual(after.session, before.session, 'budget refusal never changes the saved conversation')
  assert.deepEqual(after.usage, before.usage, 'budget refusal records no model work')
  assert.deepEqual(after.provider, before.provider, 'refused work never changes the provider definition')
  assert.deepEqual(after.config, before.config, 'budget refusal preserves the private native-key binding')
}
