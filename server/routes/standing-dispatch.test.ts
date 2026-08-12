/** D19 — open work + standing dispatch (docs/agent-commons.md): a Project's backlog of
 *  posted work items (the issues-tray analog), dispatched synchronously to `standing`
 *  Commissions. The invariant under test: the unprompted path passes EVERY wall the
 *  prompted path passes — role (D14), reach (D12), Guardian serialization (D11) — and
 *  inherits credit (D13) + audit (D15) by running through the same `runProjectEffect`.
 *  An item nothing can take stays open, visible. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from '../store/index.ts'
import { call } from '../testkit/http.ts'

const A = 'tenant-work-A'
const B = 'tenant-work-B'
let n = 0

/** A fresh shared (⇒ guarded) project owned by A, plus one of `tenant`'s agents
 *  commissioned onto it. Fresh ids per test so suites don't couple. */
function arena(opts: { standing?: boolean; tenant?: string } = {}) {
  const id = `p-work-${(n += 1)}`
  const tenant = opts.tenant ?? A
  store.applyRelationOp({ kind: 'create-project', projectId: id, projectName: `Work ${n}`, projectDescription: '' }, A)
  store.applyRelationOp({ kind: 'share-project', projectId: id, projectName: `Work ${n}`, shared: true }, A)
  const agent = store.createAgent({ label: `Worker ${n}`, systemPrompt: 'x', tools: [], instructions: '' }, tenant)
  const commission = store.createCommission({ role: 'writer', agentId: agent.id, projectId: id, standing: opts.standing }, tenant)
  return { id, agent, commission }
}

test('a standing Contributor takes a posted item: done + credited + audited, through the guarded path', async () => {
  const { id, agent, commission } = arena({ standing: true })
  const before = store.getAgent(agent.id).contributions ?? 0

  const res = await call('POST', `/projects/${id}/open-subgoals`, { subGoal: 'ship-notes', type: 'charge', target: 'budget:demo' }, { 'x-tenant-id': A })
  assert.equal(res.status, 200)
  assert.equal(res.json.status, 'done', 'the standing Contributor took it at post time')
  assert.equal(res.json.resolvedBy, commission.id)
  assert.equal(res.json.resolvedByLabel, agent.label)

  // D13 credit + D15 audit came free from runProjectEffect — the same walls as a prompted effect.
  assert.equal(store.getAgent(agent.id).contributions, before + 1, 'the agent earned the contribution')
  assert.ok(
    store.listAuditLog(A).some((e) => e.channel === 'project-effect' && e.commissionId === commission.id && e.outcome === 'fulfilled'),
    'the effect landed in the detective audit trail',
  )
  // Nothing is left held at the Guardian (reserve → commit → release ran to completion).
  assert.equal(store.projectSubGoals(id).length, 0, 'no dangling reservation')
})

test('no standing Contributor ⇒ the item stays OPEN; flipping a commission to standing re-dispatches it', async () => {
  const { id, commission } = arena({ standing: false })
  const posted = await call('POST', `/projects/${id}/open-subgoals`, { subGoal: 'later-item', type: 'charge', target: 'budget:demo' }, { 'x-tenant-id': A })
  assert.equal(posted.json.status, 'open', 'nothing standing ⇒ stays open')

  const list = await call('GET', `/projects/${id}/open-subgoals`, undefined, { 'x-tenant-id': A })
  assert.equal(list.json.length, 1)
  assert.equal(list.json[0].status, 'open')

  // The one free re-dispatch moment: a commission NEWLY flipped to standing sweeps the backlog.
  const patched = await call('PATCH', `/commissions/${commission.id}`, { standing: true }, { 'x-tenant-id': A })
  assert.equal(patched.status, 200)
  const after = await call('GET', `/projects/${id}/open-subgoals`, undefined, { 'x-tenant-id': A })
  assert.equal(after.json[0].status, 'done', 'the newly standing Contributor took the waiting item')
  assert.equal(after.json[0].resolvedBy, commission.id)
})

test('D14 wall — a reader-role standing Contributor may not take work (stays open)', async () => {
  const { id, commission } = arena({ standing: true })
  store.updateCommission(commission.id, { role: 'reader' })
  const res = await call('POST', `/projects/${id}/open-subgoals`, { subGoal: 'reader-blocked', type: 'charge', target: 'budget:demo' }, { 'x-tenant-id': A })
  assert.equal(res.json.status, 'open', 'a reader cannot reserve/fire, so dispatch skips it')
})

test('D12 wall — a connector effect the Project does not admit is not taken (stays open)', async () => {
  // A created project carries NO connector contexts, so its admitted set is empty —
  // default-deny: even an all-authority standing agent reaches nothing (D12).
  const { id } = arena({ standing: true })
  const res = await call('POST', `/projects/${id}/open-subgoals`, { subGoal: 'unreachable', type: 'connector.write', target: 'linear' }, { 'x-tenant-id': A })
  assert.equal(res.json.status, 'open', 'reach denied ⇒ the item stays open rather than firing')
  // And the D11/D13/D15 side-effects did NOT happen (no effect ran).
  assert.ok(!store.listAuditLog(A).some((e) => e.target === 'linear' && e.outcome === 'fulfilled'))
})

test('D11 wall — a sub-goal held by ANOTHER principal is not stolen (stays open)', async () => {
  const { id } = arena({ standing: true })
  store.reserveSubGoal(id, 'someone-else', 'contested-goal')
  const res = await call('POST', `/projects/${id}/open-subgoals`, { subGoal: 'contested-goal', type: 'charge', target: 'budget:demo' }, { 'x-tenant-id': A })
  assert.equal(res.json.status, 'open', 'the Guardian refused the standing taker; no preemption')
})

test('role-rank order — a maintainer volunteer wins over a writer (ties would stay first-come)', async () => {
  const { id, commission: writerC } = arena({ standing: true }) // A's, defaults to writer… promoted below
  // A second standing Contributor, maintainer role (A owns the project, so A's own
  // commission may hold an elevated role — the self-assign clamp binds only non-owners).
  const agent2 = store.createAgent({ label: 'Senior', systemPrompt: 'x', tools: [], instructions: '' }, A)
  const maintainerC = store.createCommission({ agentId: agent2.id, projectId: id, role: 'maintainer', standing: true }, A)

  const res = await call('POST', `/projects/${id}/open-subgoals`, { subGoal: 'ranked', type: 'charge', target: 'budget:demo' }, { 'x-tenant-id': A })
  assert.equal(res.json.resolvedBy, maintainerC.id, 'the higher role is offered the work first')
  assert.notEqual(res.json.resolvedBy, writerC.id)
})

test('cross-tenant — B’s standing agent takes work on A’s shared project; owner-pays attributes to B', async () => {
  const { id, agent, commission } = arena({ standing: true, tenant: B })
  const res = await call('POST', `/projects/${id}/open-subgoals`, { subGoal: 'coop-work', type: 'charge', target: 'budget:demo' }, { 'x-tenant-id': A })
  assert.equal(res.json.status, 'done')
  assert.equal(res.json.resolvedBy, commission.id, 'the foreign standing Contributor took it')
  // D13 owner-pays: the audit lands in the AGENT owner's (B's) trail, not the poster's.
  assert.ok(store.listAuditLog(B).some((e) => e.commissionId === commission.id && e.outcome === 'fulfilled'))
  assert.equal(store.getAgent(agent.id).contributions, 1)
})

test('backlog visibility mirrors the Project’s: shared ⇒ readable cross-tenant, private ⇒ 404', async () => {
  const { id } = arena()
  const shared = await call('GET', `/projects/${id}/open-subgoals`, undefined, { 'x-tenant-id': B })
  assert.equal(shared.status, 200, 'a shared project’s backlog is public')

  store.applyRelationOp({ kind: 'create-project', projectId: 'p-work-private', projectName: 'P', projectDescription: '' }, A)
  const hidden = await call('GET', '/projects/p-work-private/open-subgoals', undefined, { 'x-tenant-id': B })
  assert.equal(hidden.status, 404, 'a private project’s backlog is invisible to a foreign tenant')
  const posted = await call('POST', '/projects/p-work-private/open-subgoals', { subGoal: 's', type: 'charge', target: 't' }, { 'x-tenant-id': B })
  assert.equal(posted.status, 404, 'and cannot be posted to')
})

test('POST validation — missing fields / an unknown effect type are 400; an unknown project is 404', async () => {
  const { id } = arena()
  const missing = await call('POST', `/projects/${id}/open-subgoals`, { subGoal: '', type: 'charge', target: 't' }, { 'x-tenant-id': A })
  assert.equal(missing.status, 400)
  const badType = await call('POST', `/projects/${id}/open-subgoals`, { subGoal: 's', type: 'connector.explode', target: 't' }, { 'x-tenant-id': A })
  assert.equal(badType.status, 400)
  const noProject = await call('POST', '/projects/p-nope/open-subgoals', { subGoal: 's', type: 'charge', target: 't' }, { 'x-tenant-id': A })
  assert.equal(noProject.status, 404)
})

test('the backlog persists — an open item and a resolved one round-trip the snapshot shape', () => {
  // The persisted slice is additive-optional (like dispatch); assert both states are in
  // the store's snapshot-visible read so persist.ts carries them whole.
  const { id } = arena({ standing: true })
  store.postOpenSubGoal(id, { subGoal: 'persist-done', type: 'charge', target: 'budget:demo' }, A, undefined)
  store.postOpenSubGoal(id, { subGoal: 'persist-open', type: 'connector.write', target: 'unreachable' }, A, undefined)
  const items = store.listOpenSubGoals(id)
  assert.equal(items.length, 2)
  assert.equal(items[0].status, 'open', 'open items list first')
  assert.equal(items[1].status, 'done')
  assert.ok(items[1].resolvedAt && items[1].resolvedBy, 'the resolved item carries its credit line')
})
