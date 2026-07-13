/** Surface-audit S10 — a published Agent's D13 contribution count expands into a
 *  track record of the concrete work it resolved. The LOAD-BEARING invariant is the P8
 *  public-face redaction: only resolutions on SHARED Projects are served — a resolution
 *  on a PRIVATE Project is publicly invisible and must NEVER leak here (getting this
 *  wrong is a data breach, not a cosmetic bug). Also: existence-hiding (an invisible
 *  agent 404s) and no tenant id on the wire. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from '../server/store.ts'
import { call } from './helpers/http.ts'

const OWNER = 'tenant-arw' // owns the agent + both projects
let n = 0

const agent = () =>
  store.createAgent({ label: `ARW ${(n += 1)}`, systemPrompt: 'x', tools: [], instructions: '' }, OWNER)

function projectWithStandingTaker(agentId: string, shared: boolean): string {
  const projectId = `p-arw-${(n += 1)}`
  store.applyRelationOp({ kind: 'create-project', projectId, projectName: `ARW ${n}`, projectDescription: '' }, OWNER)
  if (shared) store.applyRelationOp({ kind: 'share-project', projectId, projectName: `ARW ${n}`, shared: true }, OWNER)
  store.createCommission({ role: 'writer', agentId, projectId, standing: true }, OWNER)
  return projectId
}
const post = (projectId: string, subGoal: string) =>
  call('POST', `/projects/${projectId}/open-subgoals`, { subGoal, type: 'charge', target: 'budget:demo' }, { 'x-tenant-id': OWNER })
const record = (agentId: string, tenant = OWNER) =>
  call('GET', `/agents/${agentId}/resolved-work`, undefined, { 'x-tenant-id': tenant })

test('THE REDACTION WALL: a resolution on a SHARED project appears; on a PRIVATE one it never leaks', async () => {
  const a = agent()
  const shared = projectWithStandingTaker(a.id, true)
  const priv = projectWithStandingTaker(a.id, false)
  const s = await post(shared, `shared-work-${n}`)
  assert.equal(s.json.status, 'done', 'the standing commission resolved the shared item')
  const p = await post(priv, `private-work-${n}`)
  assert.equal(p.json.status, 'done', 'and the private item too')

  const rec = (await record(a.id)).json as { subGoal: string }[]
  assert.ok(rec.some((r) => r.subGoal === `shared-work-${n}`), 'the shared-project resolution is in the track record')
  assert.ok(
    !rec.some((r) => r.subGoal === `private-work-${n}`),
    'the PRIVATE-project resolution is P8-redacted — it must never appear on the public track record',
  )
})

test('each row is a public-face project door — no tenant id rides the wire', async () => {
  const a = agent()
  const shared = projectWithStandingTaker(a.id, true)
  await post(shared, `door-${n}`)
  const rec = (await record(a.id)).json as any[]
  const row = rec.find((r) => r.subGoal === `door-${n}`)
  assert.ok(row && row.projectId && row.projectName && typeof row.resolvedAt === 'number', 'carries the project door + when')
  // S18 — the row also carries the work item's own id: the door to its canonical
  // page (/projects/:id/work/:itemId), whose timeline is the contribution's detail.
  assert.ok(typeof row.itemId === 'string' && row.itemId.length > 0, 'carries the work-item door (itemId)')
  assert.ok(rec.every((r) => !('tenantId' in r) && !('resolvedByTenant' in r)), 'no tenant id')
})

test('existence-hiding: an agent the caller cannot see 404s (not an empty list)', async () => {
  const a = agent() // unpublished, owned by OWNER
  const res = await record(a.id, 'tenant-stranger') // a foreign caller
  assert.equal(res.status, 404, 'an unpublished foreign agent is indistinguishable from a nonexistent one')
})

test('a published agent with no resolved work returns an empty list (visible, just empty)', async () => {
  const a = agent()
  await call('PATCH', `/agents/${a.id}`, { published: true }, { 'x-tenant-id': OWNER })
  const res = await record(a.id, 'tenant-stranger') // published ⇒ visible cross-tenant
  assert.equal(res.status, 200)
  assert.deepEqual(res.json, [])
})
