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

// ── Phase 1 — membership hardening (docs/design/test-plan-coop-lifecycle.md) ──────────

test('A7 — share-project on a SEED project id no-ops (seed Projects are not shareable in slice 1)', () => {
  const seedId = store.listProjects()[0]?.id
  assert.ok(seedId, 'there is a seed project to probe')
  // The reducer's share-project case only touches extraProjects, so a seed id is a documented
  // no-op — no throw, and the seed project stays not-shared. (Applied by the seed owner, the
  // default tenant, so the owner-only guard isn't the thing under test here.)
  store.applyRelationOp({ kind: 'share-project', projectId: seedId, projectName: 'x', shared: true }, store.defaultTenantId())
  assert.notEqual(store.findProject(seedId)?.shared, true, 'a seed project stays not-shared (share-project no-ops on seed ids)')
})

test('A6 — un-sharing after a cross-tenant Contributor joined hides the project from non-owners; the foreign commission is orphaned (current behavior + open question)', () => {
  store.applyRelationOp({ kind: 'create-project', projectId: 'p-unshare', projectName: 'Unshare', projectDescription: '' }, A)
  store.applyRelationOp({ kind: 'share-project', projectId: 'p-unshare', projectName: 'Unshare', shared: true }, A)
  const bAgent = store.createAgent({ label: 'B unshare worker', systemPrompt: 'x', tools: [], instructions: '' }, B)
  store.applyRelationOp(commissionOp(bAgent.id, 'p-unshare'), B)
  const bComm = store.listCommissions('p-unshare', B).find((c) => c.agentId === bAgent.id)
  assert.ok(bComm, 'B joined the shared project')

  // The owner un-shares (owner-only op).
  store.applyRelationOp({ kind: 'share-project', projectId: 'p-unshare', projectName: 'Unshare', shared: false }, A)

  // The project is no longer visible to the non-owner B in the graph projection.
  assert.ok(!store.relationGraph(B).extraProjects.some((p) => p.id === 'p-unshare'), 'after un-share the non-owner no longer sees the project')
  // B (the commission owner) still sees its OWN commission (registryVisible), …
  assert.ok(store.listCommissions('p-unshare', B).some((c) => c.id === bComm.id), 'B still sees its own commission after un-share')
  // … but it drops out of the project OWNER's list too (the shared-project public-list bypass is
  // gone), even though the commission still EXISTS in the store — it is orphaned, not removed.
  // Whether un-share should cascade-remove / freeze foreign commissions is the A6 open question
  // (Phase 2/D design); this locks the current behavior so a future change is a conscious one.
  assert.ok(!store.listCommissions('p-unshare', A).some((c) => c.id === bComm.id), 'the foreign Contributor drops out of the owner’s list after un-share (orphaned)')
  assert.ok(store.getCommission(bComm.id), 'the orphaned commission still exists in the store (not removed)')
})

test('B7 — the D13 commission cap on a shared Project bounds Contributors ACROSS tenants (created project is uncapped until the owner sets a cap)', () => {
  store.applyRelationOp({ kind: 'create-project', projectId: 'p-cap', projectName: 'Capped', projectDescription: '' }, A)
  store.applyRelationOp({ kind: 'share-project', projectId: 'p-cap', projectName: 'Capped', shared: true }, A)
  // A created Project has NO cap by default — uncapped until the owner sets one.
  assert.equal(store.findProject('p-cap')?.commissionCap, undefined, 'a created project is uncapped by default')
  store.setCommissionCap('p-cap', 1) // works on a created (extraProjects) project too
  assert.equal(store.findProject('p-cap')?.commissionCap, 1, 'the owner can cap a created shared project')

  // First cross-tenant Contributor (B) fills the single slot.
  const bAgent = store.createAgent({ label: 'B cap worker', systemPrompt: 'x', tools: [], instructions: '' }, B)
  store.applyRelationOp(commissionOp(bAgent.id, 'p-cap'), B)
  assert.equal(store.activeCommissionCount('p-cap'), 1)

  // A SECOND Contributor from a THIRD tenant is refused — the cap counts every tenant's
  // commissions (D13 abuse control: a stranger can't flood a shared project).
  const cAgent = store.createAgent({ label: 'C cap worker', systemPrompt: 'x', tools: [], instructions: '' }, 'tenant-C')
  assert.throws(
    () => store.applyRelationOp(commissionOp(cAgent.id, 'p-cap'), 'tenant-C'),
    (e) => e instanceof Error && /cap/i.test(e.message),
    'the shared project’s cap bounds contributors across tenants',
  )
  assert.equal(store.activeCommissionCount('p-cap'), 1, 'the over-cap cross-tenant commission did not land')
})

test('B8 — a cross-tenant self-commission cannot self-assign an elevated role (clamped to writer); reader passes; the owner keeps any role', () => {
  store.applyRelationOp({ kind: 'create-project', projectId: 'p-role', projectName: 'Roles', projectDescription: '' }, A)
  store.applyRelationOp({ kind: 'share-project', projectId: 'p-role', projectName: 'Roles', shared: true }, A)

  // B commissions its OWN agent onto A's shared project REQUESTING 'owner' → clamped to 'writer'.
  const bAgent = store.createAgent({ label: 'B role worker', systemPrompt: 'x', tools: [], instructions: '' }, B)
  store.applyRelationOp({ kind: 'commission-agent', agentId: bAgent.id, agentLabel: 'w', projectId: 'p-role', projectName: 'Roles', role: 'owner' }, B)
  assert.equal(store.listCommissions('p-role', B).find((c) => c.agentId === bAgent.id)?.role, 'writer', 'an elevated self-assigned role is clamped to writer for a cross-tenant joiner')

  // A self-downgrade to 'reader' is honored (you may join as a reader).
  const bReader = store.createAgent({ label: 'B reader', systemPrompt: 'x', tools: [], instructions: '' }, B)
  store.applyRelationOp({ kind: 'commission-agent', agentId: bReader.id, agentLabel: 'w', projectId: 'p-role', projectName: 'Roles', role: 'reader' }, B)
  assert.equal(store.listCommissions('p-role', B).find((c) => c.agentId === bReader.id)?.role, 'reader', 'a self-downgrade to reader is honored')

  // Control: the OWNER commissioning its OWN agent as 'owner' onto its OWN project keeps 'owner'.
  const aAgent = store.createAgent({ label: 'A owner worker', systemPrompt: 'x', tools: [], instructions: '' }, A)
  store.applyRelationOp({ kind: 'commission-agent', agentId: aAgent.id, agentLabel: 'w', projectId: 'p-role', projectName: 'Roles', role: 'owner' }, A)
  assert.equal(store.listCommissions('p-role', A).find((c) => c.agentId === aAgent.id)?.role, 'owner', 'the project owner may assign any role to its own contributor')
})

test('B8 (re-grant path) — a cross-tenant Contributor cannot self-elevate via updateCommission/PATCH either (the clamp is single-sourced)', () => {
  store.applyRelationOp({ kind: 'create-project', projectId: 'p-role2', projectName: 'Roles2', projectDescription: '' }, A)
  store.applyRelationOp({ kind: 'share-project', projectId: 'p-role2', projectName: 'Roles2', shared: true }, A)
  const bAgent = store.createAgent({ label: 'B regrant worker', systemPrompt: 'x', tools: [], instructions: '' }, B)
  store.applyRelationOp(commissionOp(bAgent.id, 'p-role2'), B)
  const bComm = store.listCommissions('p-role2', B).find((c) => c.agentId === bAgent.id)
  assert.equal(bComm?.role, 'writer', 'B joined as writer')

  // B PATCHes its OWN commission trying to become 'owner' — denyForeignEntry lets it (it owns the
  // commission), but the clamp holds on the re-grant path too, so no self-elevation.
  assert.equal(store.updateCommission(bComm.id, { role: 'owner' })?.role, 'writer', 'a cross-tenant self-elevation via updateCommission is clamped to writer')

  // Control: the OWNER elevating ITS OWN contributor via updateCommission is unaffected.
  const aAgent = store.createAgent({ label: 'A regrant worker', systemPrompt: 'x', tools: [], instructions: '' }, A)
  store.applyRelationOp({ kind: 'commission-agent', agentId: aAgent.id, agentLabel: 'w', projectId: 'p-role2', projectName: 'Roles2', role: 'writer' }, A)
  const aComm = store.listCommissions('p-role2', A).find((c) => c.agentId === aAgent.id)
  assert.ok(aComm, 'A has its own contributor')
  assert.equal(store.updateCommission(aComm.id, { role: 'maintainer' })?.role, 'maintainer', 'the project owner may elevate its own contributor')
})

test('review fix — an INVALID role on the commission-agent op is normalized to writer (never stored verbatim, even on the caller’s own project)', () => {
  store.applyRelationOp({ kind: 'create-project', projectId: 'p-badrole', projectName: 'BadRole', projectDescription: '' }, A)
  const aAgent = store.createAgent({ label: 'A badrole worker', systemPrompt: 'x', tools: [], instructions: '' }, A)
  // The op path casts the request JSON unchecked (unlike POST /commissions, which 400s an unknown
  // role), so a hand-crafted op could carry 'superadmin' — roleRank(invalid)=4 would outrank owner
  // and rolePermits would throw. The store normalizes it to the safe baseline.
  store.applyRelationOp(
    { kind: 'commission-agent', agentId: aAgent.id, agentLabel: 'w', projectId: 'p-badrole', projectName: 'BadRole', role: 'superadmin' } as unknown as RelationOp,
    A,
  )
  assert.equal(store.listCommissions('p-badrole', A).find((c) => c.agentId === aAgent.id)?.role, 'writer', 'an invalid role is normalized to writer (no roleRank/rolePermits corruption)')
})
