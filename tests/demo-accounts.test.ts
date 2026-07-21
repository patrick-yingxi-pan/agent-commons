/** The six demo accounts' data standard (docs/demo-accounts.md):
 *    • DISTINGUISHABLE — each account's world is disjoint from every other's
 *      (no shared session/routine/project/artifact/dispatch rows; the one
 *      designed overlap is the flagship seat's two faces, default ↔ Ada).
 *    • EXHAUSTIVE IN TYPES — every account holds at least one of each core
 *      type: sessions, a project, artifacts, a routine (with runs), a dispatch
 *      run. Shared infrastructure (providers/prompts/agents) is visible to all.
 *    • MODERATE SCALE — no huge series: ≤ 8 sessions, ≤ 3 seeded runs per
 *      routine, ≤ 3 routines per account.
 *  Plus the flagship rule: the untagged seed world belongs to the backend's
 *  default principal AND Ada/Acme (one seat, two faces), so the flagship dataset
 *  reads the same on both backends. And the rehydrate guard: a pre-split
 *  snapshot must not strip the tenancy stamps. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store, reconcileSeedTenancy } from '../server/store.ts'
import { accounts } from '../server/accounts.ts'
import { SCHEDULED_TASKS } from '../server/data/cowork.ts'
import { call } from './helpers/http.ts'

/** The six demo tenants — the flagship seat reads as BOTH the mock default
 *  (tenant-personal) and its web face (tenant-acme); we test through acme so
 *  the same assertions hold on either backend. */
const TENANTS = [
  'tenant-acme', // Ada — product & platform (the flagship dataset)
  'tenant-beta', // Grace — deploys & reliability
  'tenant-growthworks', // Maya — growth & experimentation
  'tenant-northlight', // Noor — brand & marketing
  'tenant-harbor', // Omar — support operations
  'tenant-reislab', // Rei — research & learning
]

const CREDENTIALS: Array<[string, string, string]> = [
  ['ada@acme.example', 'ada-demo-password', 'tenant-acme'],
  ['grace@acme.example', 'grace-demo-password', 'tenant-beta'], // her ONE namespace (FWD-5 Phase 2)
  ['maya@growthworks.example', 'maya-demo-password', 'tenant-growthworks'],
  ['noor@northlight.example', 'noor-demo-password', 'tenant-northlight'],
  ['omar@harborsupport.example', 'omar-demo-password', 'tenant-harbor'],
  ['rei@reislab.example', 'rei-demo-password', 'tenant-reislab'],
]

test('every demo account signs in with its documented credential and lands in its ONE namespace', async () => {
  for (const [email, password, home] of CREDENTIALS) {
    const res = await call('POST', '/auth/login', { email, password })
    assert.equal(res.status, 200, `${email} signs in`)
    assert.equal(res.json.via, 'session')
    assert.equal(res.json.tenant.id, home, `${email} lands in ${home}`)
  }
  // FWD-5 Phase 2 (the workspace collapse): every user — seed or onboarded —
  // holds exactly ONE membership; the second seats (Grace on Acme, the desktop
  // user's "Acme (work)") are gone.
  const perUser = new Map<string, number>()
  for (const m of accounts.memberships) perUser.set(m.userId, (perUser.get(m.userId) ?? 0) + 1)
  for (const [userId, count] of perUser) assert.equal(count, 1, `${userId} holds exactly one membership`)
  assert.ok(accounts.membership('user-grace', 'tenant-beta'), 'Grace’s one namespace is Beta Platform')
  assert.equal(accounts.membership('user-grace', 'tenant-acme'), undefined, 'her old Acme seat is gone')
})

test('exhaustive in types: every account holds sessions, a project, artifacts, a routine with runs, a dispatch run', () => {
  for (const t of TENANTS) {
    assert.ok(store.listSessions(t).length >= 2, `${t}: sessions`)
    assert.ok(store.listProjects(t).length >= 1, `${t}: a project`)
    assert.ok(store.listArtifacts(t).length >= 2, `${t}: artifacts`)
    const routines = store.listSchedules(t)
    assert.ok(routines.length >= 1, `${t}: a routine`)
    assert.ok(routines.some((r) => r.runs.length >= 1), `${t}: run history`)
    assert.ok(store.listDispatch(t).length >= 1, `${t}: a dispatch run`)
    assert.ok(store.recentRuns(t).length >= 1, `${t}: recent runs feed`)
  }
})

test('distinguishable: the six worlds are pairwise disjoint (no shared rows OWNED)', () => {
  // Disjointness is an OWNERSHIP invariant: no world contains another's rows as
  // its own. A social-layer grant (S1) deliberately lists a foreign project as
  // a REDACTED visitor face (`own: false`, owner-scoped fields emptied) — that
  // is a share, not tenancy leakage, so visitor faces are excluded here (their
  // redaction is locked by tests/social.test.ts).
  const lists = TENANTS.map((t) => ({
    t,
    ids: [
      ...store.listSessions(t).map((s) => `sess:${s.id}`),
      ...store.listProjects(t).filter((p) => p.own !== false).map((p) => `proj:${p.id}`),
      ...store.listArtifacts(t).map((a) => `art:${a.id}`),
      ...store.listSchedules(t).map((r) => `sched:${r.id}`),
      ...store.listDispatch(t).map((d) => `disp:${d.id}`),
    ],
  }))
  for (let i = 0; i < lists.length; i++) {
    for (let j = i + 1; j < lists.length; j++) {
      const overlap = lists[i].ids.filter((id) => lists[j].ids.includes(id))
      assert.deepEqual(overlap, [], `${lists[i].t} ∩ ${lists[j].t} must be empty`)
    }
  }
})

test('moderate scale: no huge series — bounded sessions, routines, and per-routine run history', () => {
  for (const t of TENANTS) {
    assert.ok(store.listSessions(t).length <= 8, `${t}: ≤ 8 sessions`)
    const routines = store.listSchedules(t)
    assert.ok(routines.length <= 3, `${t}: ≤ 3 routines`)
    for (const r of routines) {
      assert.ok(r.runs.length <= 3, `${t}/${r.id}: ≤ 3 seeded runs (had ${r.runs.length})`)
      assert.ok(!/\d{3,}\s*runs/.test(r.startedLabel ?? ''), `${t}/${r.id}: no huge run-count label`)
    }
  }
})

test('the flagship seat has two faces: the backend default and Ada see the same seed world', () => {
  const def = store.defaultTenantId()
  assert.deepEqual(
    store.listSessions('tenant-acme').map((s) => s.id),
    store.listSessions(def).map((s) => s.id),
    'Ada reads the flagship sessions on any backend',
  )
  assert.ok(store.listSessions('tenant-acme').some((s) => s.id === 'auth-refactor'), 'the flagship seeds are Ada’s')
  // The five themed accounts never see them.
  for (const t of TENANTS.slice(1)) {
    assert.ok(!store.listSessions(t).some((s) => s.id === 'auth-refactor'), `${t} does not see the flagship seeds`)
  }
})

test('shared infrastructure stays shared: providers/prompts/agents are visible to every account', () => {
  for (const t of TENANTS) {
    assert.ok(store.listProviders(t).length >= 1, `${t}: a model provider`)
    assert.ok(store.listSystemPrompts(t).length >= 1, `${t}: system prompts`)
    assert.ok(store.listAgents(t).length >= 1, `${t}: a worker agent`)
  }
})

test('run sessions inherit their routine’s tenant — foreign run history is invisible', () => {
  const graceRun = store.recentRuns('tenant-beta')[0]
  assert.ok(graceRun, 'Grace has a recent run')
  assert.equal(store.sessionVisibleToTenant(graceRun.session, 'tenant-beta'), true)
  assert.equal(store.sessionVisibleToTenant(graceRun.session, 'tenant-harbor'), false, 'not Omar’s to see')
})

test('a pre-split snapshot cannot strip the tenancy stamps (reconcileSeedTenancy re-applies code seeds)', () => {
  // Simulate an old snapshot's restore: the seed routines WITHOUT their stamps
  // (a pre-split build persisted them untenanted), plus a runtime-created row
  // and a runtime mutation (appended run) that must both survive.
  const live = JSON.parse(JSON.stringify(SCHEDULED_TASKS)) as typeof SCHEDULED_TASKS
  for (const r of live) delete (r as { tenantId?: string }).tenantId
  live[0].runs.unshift({ id: 'run-live-9', status: 'ok', duration: '5s', reachedStep: 1, at: 1, summary: 'kept' })
  const created = { ...JSON.parse(JSON.stringify(SCHEDULED_TASKS[0])), id: 's-created-1', tenantId: 'tenant-x' }
  live.push(created)

  reconcileSeedTenancy(live, SCHEDULED_TASKS)

  for (const seed of SCHEDULED_TASKS) {
    const got = live.find((r) => r.id === seed.id)!
    assert.equal(got.tenantId, seed.tenantId, `${seed.id} regains the code's stamp`)
  }
  assert.equal(live[0].runs[0].id, 'run-live-9', 'a runtime-appended run survives the reconcile')
  assert.equal(live.find((r) => r.id === 's-created-1')?.tenantId, 'tenant-x', 'a created routine is untouched')
})
