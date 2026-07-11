/** Registry default flags (providers + system prompts) — the UI pre-selection
 *  shortcut, and the strict API it deliberately is NOT part of.
 *
 *  The design (AGENTS.md / spec MODEL-15): a default entry is *only* what pickers
 *  pre-select when creating an Agent. So:
 *    • the flag is a per-tenant POINTER stamped at serve time (`isDefault`), moved /
 *      cleared via `isDefault` on the create/patch requests — at most one per
 *      registry per tenant, and ZERO is a valid state (pickers then fall back to the
 *      first entry, `defaultEntry`);
 *    • nothing protects the flagged entry — deleting it just clears the pointer;
 *    • the API never resolves a missing binding to it: an agent create/patch (and a
 *      confirmed create-agent proposal) must name concrete entries or is refused. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from '../server/store.ts'
import { DEFAULT_PROVIDER_ID, defaultEntry } from '../contract/index.ts'
import { call } from './helpers/http.ts'

const PROVIDER_BODY = { modelFamily: 'claude', effortLevels: ['Low', 'Medium', 'High'] }
const PROMPT_BODY = { body: 'You are terse.', targetFamily: 'claude' }

test('defaultEntry: the flagged entry wins; first-in-list is the fallback; empty list → undefined', () => {
  assert.equal(defaultEntry([]), undefined)
  const plain = [{ id: 'a' }, { id: 'b' }]
  assert.equal(defaultEntry(plain)?.id, 'a')
  const flagged = [{ id: 'a' }, { id: 'b', isDefault: true }]
  assert.equal(defaultEntry(flagged)?.id, 'b')
})

test('provider default: set on create, stamped on the list, moved by a later create — at most one', async () => {
  const first = await call('POST', '/providers', { ...PROVIDER_BODY, label: 'Default candidate A', isDefault: true })
  assert.equal(first.status, 200)
  assert.equal(first.json.isDefault, true)

  let list = (await call('GET', '/providers')).json as Array<{ id: string; isDefault?: boolean }>
  assert.deepEqual(list.filter((p) => p.isDefault).map((p) => p.id), [first.json.id], 'exactly one default')

  // A second flagged create MOVES the pointer (at most one per tenant).
  const second = await call('POST', '/providers', { ...PROVIDER_BODY, label: 'Default candidate B', isDefault: true })
  list = (await call('GET', '/providers')).json
  assert.deepEqual(list.filter((p) => p.isDefault).map((p) => p.id), [second.json.id], 'the flag moved')

  // The stored entities never carry the flag — it's a serve-time stamp of the pointer.
  assert.equal(store.getProvider(first.json.id).isDefault, undefined)
})

test('provider default: PATCH moves it, PATCH isDefault:false clears it — zero defaults is valid', async () => {
  const a = (await call('POST', '/providers', { ...PROVIDER_BODY, label: 'Movable A' })).json
  const b = (await call('POST', '/providers', { ...PROVIDER_BODY, label: 'Movable B', isDefault: true })).json

  const moved = await call('PATCH', `/providers/${a.id}`, { isDefault: true })
  assert.equal(moved.status, 200)
  assert.equal(moved.json.isDefault, true)
  let list = (await call('GET', '/providers')).json as Array<{ id: string; isDefault?: boolean }>
  assert.deepEqual(list.filter((p) => p.isDefault).map((p) => p.id), [a.id])

  // Unchecking the holder clears the flag entirely — no forced always-one default.
  const cleared = await call('PATCH', `/providers/${a.id}`, { isDefault: false })
  assert.equal(cleared.status, 200)
  assert.equal(cleared.json.isDefault, undefined)
  list = (await call('GET', '/providers')).json
  assert.equal(list.filter((p) => p.isDefault).length, 0, 'no default left — the UI falls back to first-in-list')

  // isDefault:false from a NON-holder is a no-op, not a clear.
  await call('PATCH', `/providers/${b.id}`, { isDefault: true })
  await call('PATCH', `/providers/${a.id}`, { isDefault: false })
  list = (await call('GET', '/providers')).json
  assert.deepEqual(list.filter((p) => p.isDefault).map((p) => p.id), [b.id], 'the holder keeps the flag')
})

test('deleting the flagged provider is allowed and simply clears the pointer (no protection)', async () => {
  const doomed = (await call('POST', '/providers', { ...PROVIDER_BODY, label: 'Doomed default', isDefault: true })).json
  const del = await call('DELETE', `/providers/${doomed.id}`)
  assert.equal(del.status, 200, 'the default flag never blocks deletion — it is a UI shortcut, not an invariant')
  const list = (await call('GET', '/providers')).json as Array<{ isDefault?: boolean }>
  assert.equal(list.filter((p) => p.isDefault).length, 0, 'the dangling pointer was dropped with the entry')
})

test('the default flag is per-tenant: one tenant’s flag never stamps another’s view', () => {
  const mine = store.createProvider({ ...PROVIDER_BODY, label: 'Tenant-A default', authority: {} }, {}, 'tenant-reg-a')
  store.setDefaultProvider(mine.id, 'tenant-reg-a')
  assert.ok(
    store.listProviders('tenant-reg-a').find((p) => p.id === mine.id)?.isDefault,
    'stamped for its own tenant',
  )
  // Another tenant neither sees the entry nor inherits the flag anywhere.
  assert.equal(store.listProviders('tenant-reg-b').filter((p) => p.isDefault).length, 0)
  // And a shared seed flagged by A is A's default only.
  store.setDefaultProvider(DEFAULT_PROVIDER_ID, 'tenant-reg-a')
  assert.ok(store.listProviders('tenant-reg-a').find((p) => p.id === DEFAULT_PROVIDER_ID)?.isDefault)
  assert.equal(store.listProviders('tenant-reg-b').filter((p) => p.isDefault).length, 0)
})

test('system-prompt default: create/patch set + move + clear, delete drops the pointer', async () => {
  const a = (await call('POST', '/system-prompts', { ...PROMPT_BODY, label: 'Default prompt A', isDefault: true })).json
  assert.equal(a.isDefault, true)
  let list = (await call('GET', '/system-prompts')).json as Array<{ id: string; isDefault?: boolean }>
  assert.deepEqual(list.filter((p) => p.isDefault).map((p) => p.id), [a.id])

  const b = (await call('POST', '/system-prompts', { ...PROMPT_BODY, label: 'Default prompt B' })).json
  await call('PATCH', `/system-prompts/${b.id}`, { isDefault: true })
  list = (await call('GET', '/system-prompts')).json
  assert.deepEqual(list.filter((p) => p.isDefault).map((p) => p.id), [b.id], 'moved by PATCH')

  const cleared = await call('PATCH', `/system-prompts/${b.id}`, { isDefault: false })
  assert.equal(cleared.json.isDefault, undefined)
  list = (await call('GET', '/system-prompts')).json
  assert.equal(list.filter((p) => p.isDefault).length, 0)

  // Delete the (re-)flagged entry: allowed, pointer dropped.
  await call('PATCH', `/system-prompts/${a.id}`, { isDefault: true })
  const del = await call('DELETE', `/system-prompts/${a.id}`)
  assert.equal(del.status, 200)
  list = (await call('GET', '/system-prompts')).json
  assert.equal(list.filter((p) => p.isDefault).length, 0)
})

test('a confirmed create-agent proposal without concrete bindings is refused (400), never defaulted', async () => {
  const refused = await call('POST', '/relations/ops', {
    op: { kind: 'create-agent', label: 'Stale proposal agent' },
  })
  assert.equal(refused.status, 400, 'the apply path enforces the same strictness as POST /agents')
  // And with concrete bindings the same op applies fine.
  const ok = await call('POST', '/relations/ops', {
    op: {
      kind: 'create-agent',
      label: 'Concrete proposal agent',
      providerId: DEFAULT_PROVIDER_ID,
      systemPromptId: 'sp-default',
    },
  })
  assert.equal(ok.status, 200)
  assert.ok(store.listAgents().some((agent) => agent.label === 'Concrete proposal agent'))
})
