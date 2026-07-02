/** P8 Phase 2 — the cross-TENANT cooperation RUNTIME (Stage C of the lifecycle: agents from
 *  different users actually WORKING TOGETHER on one shared Project). Phase 1 built membership
 *  (share + commission); the "bridge" (this phase) makes a shared CREATED Project cooperable —
 *  it gains a `guardianId` on share, and the D11 guardian / D12 clamp / D14 role tier resolve it
 *  via `findProject` (was seed-only). This locks that the cooperation mechanics — proven
 *  single-tenant in project-subgoals / isolation / roles — hold ACROSS the F2 tenant boundary.
 *  Membership + isolation are locked in cross-tenant-cooperation.test.ts + capability-remote. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from '../server/store.ts'
import { GuardianError } from '../server/guardian.ts'
import { call } from './helpers/http.ts'
import type { RelationOp } from '../contract/index.ts'

const A = 'tenant-A'
const B = 'tenant-B'
const C = 'tenant-C'
const commissionOp = (agentId: string, projectId: string): RelationOp =>
  ({ kind: 'commission-agent', agentId, agentLabel: 'w', projectId, projectName: 'p' })
const shareOp = (projectId: string): RelationOp => ({ kind: 'share-project', projectId, projectName: 'p', shared: true })
const scopeConnector = (projectId: string, label: string): RelationOp =>
  ({ kind: 'scope-context', projectId, projectName: 'p', context: { kind: 'connector', label, meta: '' } } as RelationOp)

test('the bridge — sharing a created Project makes it a guarded, coordinated resource (guardianId = its id)', () => {
  store.applyRelationOp({ kind: 'create-project', projectId: 'p-bridge', projectName: 'Bridge', projectDescription: '' }, A)
  assert.equal(store.findProject('p-bridge')?.guardianId, undefined, 'a fresh created project is unguarded')
  store.applyRelationOp(shareOp('p-bridge'), A)
  assert.equal(store.findProject('p-bridge')?.guardianId, 'p-bridge', 'sharing assigns a guardianId (= its id, the seed convention)')
})

test('C4 (D12 clamp cross-tenant) — a cross-tenant Contributor granted everything is walled to the shared Project’s admitted set', () => {
  store.applyRelationOp({ kind: 'create-project', projectId: 'p-clamp', projectName: 'Clamp', projectDescription: '' }, A)
  store.applyRelationOp(shareOp('p-clamp'), A)
  // The OWNER defines the admitted set by scoping a connector context onto the shared Project
  // (owner-only). The clamp reads this authoritative join-map set, so it works for a created Project.
  store.applyRelationOp(scopeConnector('p-clamp', 'Linear'), A)

  // B commissions its OWN agent (unrestricted via the default provider) onto the shared Project.
  const bAgent = store.createAgent({ label: 'B clamp worker', systemPrompt: 'x', tools: [], instructions: '' }, B)
  store.applyRelationOp(commissionOp(bAgent.id, 'p-clamp'), B)
  const bComm = store.listCommissions('p-clamp', B).find((c) => c.agentId === bAgent.id)
  assert.ok(bComm, 'B joined the shared project')

  // The effective (clamped) reach is EXACTLY the shared Project's admitted set — the make-or-break
  // D12 property across the tenant boundary: a stranger's agent granted everything reaches only
  // what the Project admits, never the owner's ambient connectors.
  assert.deepEqual(store.commissionAuthority(bComm.id)?.connectors, ['Linear'], 'the cross-tenant contributor is clamped to the shared project’s admitted connectors')
  assert.equal(store.commissionCanReach(bComm.id, 'connectors', 'Linear'), true, 'an admitted connector is reachable')
  assert.equal(store.commissionCanReach(bComm.id, 'connectors', 'Salesforce'), false, 'a non-admitted connector is default-denied across the tenant boundary')
})

test('C1/C2/C3 (guardian cross-tenant) — two different-tenant Contributors coordinate sub-goals on one shared Project', () => {
  store.applyRelationOp({ kind: 'create-project', projectId: 'p-guard', projectName: 'Guard', projectDescription: '' }, A)
  store.applyRelationOp(shareOp('p-guard'), A)
  const bAgent = store.createAgent({ label: 'B guard', systemPrompt: 'x', tools: [], instructions: '' }, B)
  const cAgent = store.createAgent({ label: 'C guard', systemPrompt: 'x', tools: [], instructions: '' }, C)
  store.applyRelationOp(commissionOp(bAgent.id, 'p-guard'), B)
  store.applyRelationOp(commissionOp(cAgent.id, 'p-guard'), C)
  const bComm = store.listCommissions('p-guard', B).find((c) => c.agentId === bAgent.id)!
  const cComm = store.listCommissions('p-guard', C).find((c) => c.agentId === cAgent.id)!

  // C1 — different sub-goals: both tenants proceed concurrently (distinct resources).
  assert.equal(store.reserveSubGoal('p-guard', bComm.id, 'goal-b').status, 'held')
  assert.equal(store.reserveSubGoal('p-guard', cComm.id, 'goal-c').status, 'held')

  // C2 — the SAME sub-goal: the second (different-tenant) holder is refused (first-come, 409).
  store.reserveSubGoal('p-guard', bComm.id, 'goal-shared')
  assert.throws(() => store.reserveSubGoal('p-guard', cComm.id, 'goal-shared'), GuardianError, 'a same sub-goal is refused to a different tenant’s contributor')

  // C3 — release, then the other tenant may take it.
  const held = store.projectSubGoals('p-guard').find((s) => s.subGoal === 'goal-shared')!
  store.releaseSubGoal(held.reservationId)
  assert.doesNotThrow(() => store.reserveSubGoal('p-guard', cComm.id, 'goal-shared'), 'after release the other tenant takes the sub-goal')

  // The Coordination surface sees BOTH tenants' contributors in flight on the one shared Project.
  const holders = store.projectSubGoals('p-guard').map((s) => s.holder)
  assert.ok(holders.includes(bComm.id) && holders.includes(cComm.id), 'both tenants’ contributors coordinate on the shared project')
})

test('C5 (roles cross-tenant) — a reader Contributor may not fire/reserve; a writer may (D14 across tenants)', () => {
  store.applyRelationOp({ kind: 'create-project', projectId: 'p-crole', projectName: 'CRole', projectDescription: '' }, A)
  store.applyRelationOp(shareOp('p-crole'), A)
  const bReader = store.createAgent({ label: 'B reader', systemPrompt: 'x', tools: [], instructions: '' }, B)
  const bWriter = store.createAgent({ label: 'B writer', systemPrompt: 'x', tools: [], instructions: '' }, B)
  // B self-joins as reader (self-downgrade is allowed) and as writer (the default).
  store.applyRelationOp({ kind: 'commission-agent', agentId: bReader.id, agentLabel: 'w', projectId: 'p-crole', projectName: 'CRole', role: 'reader' }, B)
  store.applyRelationOp(commissionOp(bWriter.id, 'p-crole'), B)
  const rComm = store.listCommissions('p-crole', B).find((c) => c.agentId === bReader.id)!
  const wComm = store.listCommissions('p-crole', B).find((c) => c.agentId === bWriter.id)!
  assert.equal(rComm.role, 'reader')
  assert.equal(wComm.role, 'writer')

  // The role gate is a property of the Commission, not of tenant match — it holds cross-tenant.
  assert.equal(store.commissionRolePermits(rComm.id, 'fire'), false, 'a cross-tenant reader may not fire')
  assert.equal(store.commissionRolePermits(rComm.id, 'reserve'), false, 'a cross-tenant reader may not reserve')
  assert.equal(store.commissionRolePermits(wComm.id, 'fire'), true, 'a cross-tenant writer may fire')
})

test('C12 (CALM cross-tenant) — a monotonic effect bypasses the guardian even when another tenant holds the sub-goal; a non-monotonic one conflicts', () => {
  store.applyRelationOp({ kind: 'create-project', projectId: 'p-calm', projectName: 'Calm', projectDescription: '' }, A)
  store.applyRelationOp(shareOp('p-calm'), A)
  store.applyRelationOp(scopeConnector('p-calm', 'Linear'), A)
  const bAgent = store.createAgent({ label: 'B calm', systemPrompt: 'x', tools: [], instructions: '' }, B)
  const cAgent = store.createAgent({ label: 'C calm', systemPrompt: 'x', tools: [], instructions: '' }, C)
  store.applyRelationOp(commissionOp(bAgent.id, 'p-calm'), B)
  store.applyRelationOp(commissionOp(cAgent.id, 'p-calm'), C)
  const bComm = store.listCommissions('p-calm', B).find((c) => c.agentId === bAgent.id)!
  const cComm = store.listCommissions('p-calm', C).find((c) => c.agentId === cAgent.id)!

  // C holds the sub-goal 'sg'.
  store.reserveSubGoal('p-calm', cComm.id, 'sg')
  // A MONOTONIC effect (connector.read) by B on the SAME sub-goal succeeds — it bypasses the
  // guardian (CALM: reads don't need a reservation), so it doesn't contend with C's hold.
  assert.doesNotThrow(() => store.runProjectEffect('p-calm', bComm.id, 'sg', 'connector.read', 'Linear'), 'a monotonic effect bypasses the guardian cross-tenant')
  // A NON-monotonic effect (connector.write) by B on the SAME held sub-goal conflicts (409).
  assert.throws(() => store.runProjectEffect('p-calm', bComm.id, 'sg', 'connector.write', 'Linear'), GuardianError, 'a non-monotonic effect serializes on the held sub-goal → conflict')
})

test('route — POST /projects/:id/effects reaches a shared CREATED project (was 404 via seed-only listProjects)', async () => {
  const D = store.defaultTenantId()
  store.applyRelationOp({ kind: 'create-project', projectId: 'p-route-eff', projectName: 'RouteEff', projectDescription: '' }, D)
  store.applyRelationOp(shareOp('p-route-eff'), D)
  store.applyRelationOp(scopeConnector('p-route-eff', 'Linear'), D)
  const comm = store.createCommission({ agentId: 'agent-default', projectId: 'p-route-eff' }, D)

  // A non-monotonic connector effect on the admitted connector, holding a fresh sub-goal — the
  // route must find the created project (bridge) and run it (before the fix this was a 404).
  const res = await call('POST', '/projects/p-route-eff/effects', { commissionId: comm.id, subGoal: 'sg1', type: 'connector.write', target: 'Linear' })
  assert.equal(res.status, 200, 'the effect route reaches a shared created project (bridge)')

  // A control: an unknown project still 404s.
  const missing = await call('POST', '/projects/p-nope/effects', { commissionId: comm.id, subGoal: 'sg1', type: 'connector.write', target: 'Linear' })
  assert.equal(missing.status, 404, 'an unknown project still 404s')
})
