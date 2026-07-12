/** FWD-5 Phase 1 — the actor/owner split (docs/design/principals-and-namespaces.md).
 *  The invariants under test: every NATIVE act (post / comment / retract / propose /
 *  proposal-comment) is stamped with its acting principal and the wire face carries
 *  the principal's KIND beside the display name (`postedByKind` / `authorKind` /
 *  `retractedByKind` / `proposedByKind`: 'user' for a signed-in human); the raw
 *  `PrincipalRef` — like the raw tenant id — NEVER crosses a public projection; and
 *  a foreign A2A act carries NO kind (its attribution is `verifiedPeer`/`via`, D28 —
 *  a remote agent never gets a local principal id). The required-but-undefinable
 *  `principal` parameter on the store mutators is the compile-side half of the lock:
 *  no future call site can silently skip the attribution decision. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from '../server/store.ts'
import { call } from './helpers/http.ts'

const A = 'tenant-prin-A' // project owner
const B = 'tenant-prin-B' // poster / commenter / proposer
let n = 0

/** A shared project owned by A with one open item posted (natively) by B. */
async function arena() {
  const projectId = `p-prin-${(n += 1)}`
  store.applyRelationOp({ kind: 'create-project', projectId, projectName: `Prin ${n}`, projectDescription: '' }, A)
  store.applyRelationOp({ kind: 'share-project', projectId, projectName: `Prin ${n}`, shared: true }, A)
  const posted = await call(
    'POST', `/projects/${projectId}/open-subgoals`,
    { subGoal: `prin-item-${n}`, type: 'charge', target: 'budget:demo', note: '' },
    { 'x-tenant-id': B },
  )
  assert.equal(posted.status, 200)
  return { projectId, item: posted.json as Record<string, unknown> }
}

test('a native post is stamped with a user principal; only the KIND crosses the wire', async () => {
  const { item } = await arena()
  assert.equal(item.postedByKind, 'user', 'the route stamps the signed-in human')
  const wire = JSON.stringify(item)
  for (const leaked of ['postedByPrincipal', 'postedByTenant', '"principal"']) {
    assert.ok(!wire.includes(leaked), `the public projection must not carry ${leaked}`)
  }
})

test('a native comment carries authorKind user; the stored principal never crosses', async () => {
  const { projectId, item } = await arena()
  const out = await call('POST', `/projects/${projectId}/open-subgoals/${item.id}/comments`, { body: 'who takes this?' }, { 'x-tenant-id': A })
  assert.equal(out.status, 200)
  const comment = out.json.comments[0]
  assert.equal(comment.authorKind, 'user')
  assert.ok(!JSON.stringify(out.json).includes('"principal"'), 'comment principals are server-private')
})

test('a native retract carries retractedByKind user', async () => {
  const { projectId, item } = await arena()
  const out = await call('POST', `/projects/${projectId}/open-subgoals/${item.id}/retract`, undefined, { 'x-tenant-id': B })
  assert.equal(out.status, 200)
  assert.equal(out.json.retractedByKind, 'user')
})

test('a foreign A2A act carries NO kind — verifiedPeer is its attribution (D28)', async () => {
  const projectId = `p-prin-a2a-${(n += 1)}`
  store.applyRelationOp({ kind: 'create-project', projectId, projectName: `Prin A2A ${n}`, projectDescription: '' }, A)
  store.applyRelationOp({ kind: 'share-project', projectId, projectName: `Prin A2A ${n}`, shared: true }, A)
  const item = store.postOpenSubGoal(
    projectId, { subGoal: 'from-the-edge', type: 'charge', target: 'budget:demo' },
    B, undefined, 'a2a', 'Registered Peer',
  )
  assert.equal(item.postedByKind, undefined, 'no local principal for a remote actor')
  assert.equal(item.postedBy, 'Registered Peer')
  assert.equal(item.via, 'a2a')
  const commented = store.commentOnOpenSubGoal(projectId, item.id, 'edge comment', B, undefined, 'Registered Peer')
  assert.ok(commented && typeof commented === 'object')
  assert.equal(commented.comments?.[0].authorKind, undefined)
})

test('a proposal + its thread stamp user principals; the projection strips the refs', async () => {
  const agent = store.createAgent({ label: `Prin Agent ${(n += 1)}`, systemPrompt: 'x', tools: [], instructions: '' }, A)
  await call('PATCH', `/agents/${agent.id}`, { published: true }, { 'x-tenant-id': A })
  const proposed = await call('POST', `/agents/${agent.id}/proposals`, { fields: { label: 'Prin Agent v2' }, note: 'rename' }, { 'x-tenant-id': B })
  assert.equal(proposed.status, 200)
  assert.equal(proposed.json.proposedByKind, 'user')
  const pid = proposed.json.id as string
  const commented = await call('POST', `/agents/${agent.id}/proposals/${pid}/comments`, { body: 'why?' }, { 'x-tenant-id': A })
  assert.equal(commented.status, 200)
  assert.equal(commented.json.comments[0].authorKind, 'user')
  const wire = JSON.stringify(commented.json)
  for (const leaked of ['proposedByPrincipal', 'proposedByTenant', '"principal"']) {
    assert.ok(!wire.includes(leaked), `the public projection must not carry ${leaked}`)
  }
})

test('a standing resolution carries the FULL attribution chain: who, under what grant, for which owner', async () => {
  const projectId = `p-prin-chain-${(n += 1)}`
  store.applyRelationOp({ kind: 'create-project', projectId, projectName: `Prin chain ${n}`, projectDescription: '' }, A)
  store.applyRelationOp({ kind: 'share-project', projectId, projectName: `Prin chain ${n}`, shared: true }, A)
  // B's agent, commissioned as a STANDING contributor onto A's shared project.
  const agent = store.createAgent({ label: `Prin Worker ${n}`, systemPrompt: 'x', tools: [], instructions: '' }, B)
  const commission = store.createCommission({ role: 'writer', agentId: agent.id, projectId, standing: true }, B)
  const res = await call(
    'POST', `/projects/${projectId}/open-subgoals`,
    { subGoal: `chain-${n}`, type: 'charge', target: 'budget:demo' },
    { 'x-tenant-id': A },
  )
  assert.equal(res.status, 200)
  assert.equal(res.json.status, 'done', 'the standing contributor took it at post time')
  assert.equal(res.json.resolvedBy, commission.id, 'the GRANT it acted under (the commission)')
  assert.equal(res.json.resolvedByLabel, agent.label, 'WHO — the agent principal')
  // The owner leg is captured AT ACT TIME (FWD-5 Phase 3) — a dev-seam tenant
  // displays as its id; a registry namespace as its display name.
  assert.equal(res.json.resolvedByOwner, B, 'FOR WHICH owner namespace')
})
