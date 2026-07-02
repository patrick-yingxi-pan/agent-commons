/** P8 slice 1 — cross-TENANT cooperation on a shared Project (the "many users' agents on one
 *  shared task" case). Extends the existing per-Contributor cooperation (COMMONS-2 authority
 *  clamp, COMMONS-3 guardian, COMMONS-4 roles) across the F2 tenant boundary:
 *    • an owner marks its Project shared (`share-project`, owner-only);
 *    • a DIFFERENT tenant may commission its OWN agent onto it (D13 owner-pays);
 *    • the shared Project's Contributor list is public across tenants;
 *  while ISOLATION is preserved — a private Project still refuses a cross-tenant commission,
 *  and no tenant can conscript another's agent. The opposite face (isolation) is locked in
 *  tests/project-tenancy.test.ts + capability-remote.test.ts. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from '../server/store.ts'
import type { RelationOp } from '../contract/index.ts'

const A = 'tenant-A'
const B = 'tenant-B'
const commissionOp = (agentId: string, projectId: string): RelationOp =>
  ({ kind: 'commission-agent', agentId, agentLabel: 'w', projectId, projectName: 'p' })

test('a shared Project admits a cross-tenant Contributor; the list is public; owner-pays attributes to the agent owner', () => {
  store.applyRelationOp({ kind: 'create-project', projectId: 'p-coop', projectName: 'Shared effort', projectDescription: '' }, A)
  store.applyRelationOp({ kind: 'share-project', projectId: 'p-coop', projectName: 'Shared effort', shared: true }, A)
  const bAgent = store.createAgent({ label: 'B worker', systemPrompt: 'x', tools: [], instructions: '' }, B)

  // The cooperation primitive: B commissioning ITS agent onto A's SHARED project is allowed
  // (this exact op was DENIED before P8 — see the probe in the isolation discussion).
  assert.equal(store.opDeniedForTenant(commissionOp(bAgent.id, 'p-coop'), B), false, 'cross-tenant commission onto a shared project is allowed')
  store.applyRelationOp(commissionOp(bAgent.id, 'p-coop'), B)

  // The Contributor list on a shared project is public — owner A and contributor B both see it.
  assert.ok(store.listCommissions('p-coop', A).some((c) => c.agentId === bAgent.id), 'the project owner sees the cross-tenant Contributor')
  const bComm = store.listCommissions('p-coop', B).find((c) => c.agentId === bAgent.id)
  assert.ok(bComm, 'the contributing tenant sees its own commission')

  // D13 owner-pays: the commission belongs to B, and metering attributes to the AGENT owner
  // (B), NOT the project owner (A).
  assert.equal(bComm.tenantId, B, 'the commission is owned by the contributing tenant')
  assert.equal(store.commissionOwnerTenant(bComm.id), B, 'owner-pays attributes to the agent owner, not the project owner')
})

test('isolation preserved — a PRIVATE project still refuses a cross-tenant commission', () => {
  store.applyRelationOp({ kind: 'create-project', projectId: 'p-private', projectName: 'Private', projectDescription: '' }, A)
  const bAgent = store.createAgent({ label: 'B worker 2', systemPrompt: 'x', tools: [], instructions: '' }, B)
  assert.equal(store.opDeniedForTenant(commissionOp(bAgent.id, 'p-private'), B), true, 'a private foreign project still refuses the commission')
})

test('no conscription — commissioning a FOREIGN agent onto a shared project is refused', () => {
  store.applyRelationOp({ kind: 'create-project', projectId: 'p-coop2', projectName: 'Shared 2', projectDescription: '' }, A)
  store.applyRelationOp({ kind: 'share-project', projectId: 'p-coop2', projectName: 'Shared 2', shared: true }, A)
  const bAgent = store.createAgent({ label: 'B worker 3', systemPrompt: 'x', tools: [], instructions: '' }, B)
  // A tries to commission B's agent — refused by the agent-subject axis (you commission your own).
  assert.equal(store.opDeniedForTenant(commissionOp(bAgent.id, 'p-coop2'), A), true, 'a tenant cannot conscript another tenant’s agent onto its own shared project')
})

test('sharing is owner-only — a non-owner cannot share another tenant’s project', () => {
  store.applyRelationOp({ kind: 'create-project', projectId: 'p-owned', projectName: 'Owned', projectDescription: '' }, A)
  assert.equal(
    store.opDeniedForTenant({ kind: 'share-project', projectId: 'p-owned', projectName: 'Owned', shared: true }, B),
    true,
    'only the owner may share its project',
  )
})

test('redaction — a non-owner sees a shared project WITHOUT the owner’s session ids / contexts', () => {
  // A creates a project with a FOUNDING session (the tour's create-from-session path), then shares it.
  store.applyRelationOp({ kind: 'create-project', projectId: 'p-redact', projectName: 'Redact', projectDescription: '', sessionId: 'sess-A-secret', sessionTitle: 'A secret' }, A)
  store.applyRelationOp({ kind: 'share-project', projectId: 'p-redact', projectName: 'Redact', shared: true }, A)

  // The OWNER sees its own founding session on the project object.
  assert.deepEqual(store.relationGraph(A).extraProjects.find((p) => p.id === 'p-redact')?.sessionIds, ['sess-A-secret'], 'the owner sees its own session ids')

  // A NON-owner sees the shared project but its owner-scoped fields are stripped — no leak of
  // A's session id or count across the tenant boundary.
  const forB = store.relationGraph(B).extraProjects.find((p) => p.id === 'p-redact')
  assert.ok(forB, 'the non-owner sees the shared project')
  assert.deepEqual(forB.sessionIds, [], 'the owner’s session ids are stripped from the non-owner view')
  assert.deepEqual(forB.contexts, [], 'the owner’s contexts are stripped too')
})

test('redaction — a shared project’s Contributor list hides foreign authority/grant (D12 posture stays private)', () => {
  const aAgent = store.createAgent({ label: 'A worker', systemPrompt: 'x', tools: [], instructions: '' }, A)
  store.applyRelationOp({ kind: 'create-project', projectId: 'p-redact2', projectName: 'R2', projectDescription: '' }, A)
  store.applyRelationOp({ kind: 'share-project', projectId: 'p-redact2', projectName: 'R2', shared: true }, A)
  // A commissions its own agent with a concrete authority + token grant (subset of the '*' default).
  const comm = store.createCommission(
    { agentId: aAgent.id, projectId: 'p-redact2', authority: { connectors: ['Linear'] }, grant: { windows: [{ label: '5-hour limit', ceiling: 1000 }] } },
    A,
  )
  assert.ok(comm.authority && comm.grant, 'the created commission carries authority + grant')

  // An uninvolved THIRD tenant viewing the shared Project's contributors sees IDENTITY ONLY.
  const seenByC = store.listCommissions('p-redact2', 'tenant-C').find((c) => c.id === comm.id)
  assert.ok(seenByC, 'the contributor is public on the shared project')
  assert.equal(seenByC.authority, undefined, 'foreign authority is redacted')
  assert.equal(seenByC.grant, undefined, 'the foreign token grant is redacted')
  assert.equal(seenByC.agentId, aAgent.id, 'but the public identity (agent) is present')
  // by-id is consistent with the list: the foreign contributor is visible, redacted (not 404).
  const byId = store.commissionVisibleToTenant(comm.id, 'tenant-C')
  assert.ok(byId && byId.authority === undefined, 'by-id returns the redacted contributor, consistent with the list')

  // The OWNER still sees the full commission (authority + grant intact).
  const seenByA = store.listCommissions('p-redact2', A).find((c) => c.id === comm.id)
  assert.ok(seenByA?.authority && seenByA?.grant, 'the owner sees the full commission')
})

test('graph projection — a shared project is visible cross-tenant; a private one is not', () => {
  store.applyRelationOp({ kind: 'create-project', projectId: 'p-vis-shared', projectName: 'Vis shared', projectDescription: '' }, A)
  store.applyRelationOp({ kind: 'share-project', projectId: 'p-vis-shared', projectName: 'Vis shared', shared: true }, A)
  store.applyRelationOp({ kind: 'create-project', projectId: 'p-vis-private', projectName: 'Vis private', projectDescription: '' }, A)

  const gB = store.relationGraph(B)
  assert.ok(gB.extraProjects.some((p) => p.id === 'p-vis-shared' && p.shared), 'a non-owner sees the shared project (flagged shared)')
  assert.ok(!gB.extraProjects.some((p) => p.id === 'p-vis-private'), 'a non-owner does NOT see a private project')
})
