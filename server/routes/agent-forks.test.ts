/** S18 — a published definition's fork COUNTER expands into the enumerable PUBLIC
 *  forks behind it (GET /agents/:id/forks). The LOAD-BEARING invariant is the P8
 *  wall: a fork lives in its owner's PRIVATE registry until published, so only
 *  PUBLISHED forks are listed — the count may honestly exceed the list, and an
 *  unpublished fork must never leak (its existence is another tenant's private
 *  registry row). Also: existence-hiding (an invisible source 404s), no tenant id
 *  on the wire, and the viewer-relative `own` flag. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from '../store/index.ts'
import { call } from '../testkit/http.ts'

const OWNER = 'tenant-forks-owner'
const FORKER = 'tenant-forks-forker'
let n = 0

async function publishedAgent(tenant = OWNER) {
  const a = store.createAgent({ label: `Forkable ${(n += 1)}`, systemPrompt: 'x', tools: [], instructions: '' }, tenant)
  await call('PATCH', `/agents/${a.id}`, { published: true }, { 'x-tenant-id': tenant })
  return a
}
const forksOf = (agentId: string, tenant = OWNER) =>
  call('GET', `/agents/${agentId}/forks`, undefined, { 'x-tenant-id': tenant })

test('THE P8 WALL: an unpublished fork never appears; publishing it does', async () => {
  const src = await publishedAgent()
  const fork = (await call('POST', `/agents/${src.id}/fork`, {}, { 'x-tenant-id': FORKER })).json as { id: string }

  let list = (await forksOf(src.id)).json as any[]
  assert.ok(
    !list.some((f) => f.agentId === fork.id),
    'a PRIVATE fork must never leak on the public forks list — its existence is the forker’s private registry',
  )

  await call('PATCH', `/agents/${fork.id}`, { published: true }, { 'x-tenant-id': FORKER })
  list = (await forksOf(src.id)).json as any[]
  const row = list.find((f) => f.agentId === fork.id)
  assert.ok(row, 'once the forker publishes, the fork is a public act and lists')
  assert.equal(row.own, false, '`own` is viewer-relative (the source owner does not own the fork)')
  assert.ok(row.owner && !('tenantId' in row), 'owner is the public display name; no tenant id rides the wire')
  assert.equal(typeof row.forkedAtVersion, 'number', 'carries the source version the fork was taken at')

  const asForker = (await forksOf(src.id, FORKER)).json as any[]
  assert.equal(asForker.find((f) => f.agentId === fork.id)?.own, true, 'the forker sees their fork as their own')
})

test('existence-hiding: a source the caller cannot see 404s (not an empty list)', async () => {
  const a = store.createAgent({ label: `Hidden ${(n += 1)}`, systemPrompt: 'x', tools: [], instructions: '' }, OWNER)
  const res = await forksOf(a.id, 'tenant-stranger') // unpublished + foreign caller
  assert.equal(res.status, 404, 'an unpublished foreign agent is indistinguishable from a nonexistent one')
})

test('a published agent with no public forks returns an empty list (visible, just empty)', async () => {
  const a = await publishedAgent()
  const res = await forksOf(a.id, 'tenant-stranger')
  assert.equal(res.status, 200)
  assert.deepEqual(res.json, [])
})
