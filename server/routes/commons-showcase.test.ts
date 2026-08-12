/** The commons showcase (the sample-projects pass): ten shared projects, each
 *  staging a DISTINCT stage of the contribution workflow (COMMONS-28…33), seeded
 *  through the REAL mutators on first boot so every stage is visible on first
 *  sign-in — the demo is the argument. This lock asserts the staging is real
 *  state (walls, tiers, envelopes, delegations all came out of the funnels), and
 *  that re-seeding is a no-op (rehydrate must not double-seed). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from '../store/index.ts'
import { call } from '../testkit/http.ts'

const ADA = 'tenant-acme' // the flagship face; the seeder writes as the default seat
const GRACE = 'tenant-beta'
const MAYA = 'tenant-growthworks'
const NOOR = 'tenant-northlight'
const OMAR = 'tenant-harbor'
const REI = 'tenant-reislab'

const SHOWCASE = [
  'p-field-guide',
  'p-launch-broadcast',
  'p-postmortem-library',
  'p-experiment-registry',
  'p-macro-commons',
  'p-reading-circle',
  'p-token-garden',
  'p-data-dictionary',
  'p-onboarding-trailhead',
  'p-release-atelier',
]

store.seedCommonsShowcase()

test('all ten showcase projects exist, shared, with a README — and re-seeding is a no-op', async () => {
  for (const id of SHOWCASE) {
    const p = store.findProject(id)
    assert.ok(p, `${id} exists`)
    assert.equal(p!.shared, true, `${id} is a commons project`)
  }
  const before = store.listContributions('p-field-guide').length
  store.seedCommonsShowcase()
  assert.equal(store.listContributions('p-field-guide').length, before, 'idempotent — a rehydrated world is not double-seeded')
})

test('the field guide stages the linear ledger + earned trust (L1–L3, then a Tier-0 fourth)', async () => {
  const list = (await call('GET', '/projects/p-field-guide/contributions', undefined, { 'x-tenant-id': REI })).json
  const landed = list.filter((c: any) => c.status === 'landed')
  assert.deepEqual(landed.map((c: any) => c.landingNumber), [3, 2, 1], 'three landings, newest first')
  const fourth = list.find((c: any) => c.status === 'open')
  assert.equal(fourth.tier.level, 0, 'the fourth contribution reads Tier 0 — trust was EARNED through the ledger')
  assert.match(fourth.tier.basis, /trusted: 3 landed here/)
})

test('the broadcast stages the envelope: one approved half-used, one proposed as the owner’s liability ask', async () => {
  const list = (await call('GET', '/projects/p-launch-broadcast/contributions', undefined, { 'x-tenant-id': NOOR })).json
  const approved = list.find((c: any) => c.envelope?.status === 'approved')
  assert.equal(approved.envelope.lines[0].used, 1)
  assert.equal(approved.envelope.lines[0].harness, 'draft-escrow')
  const attention = (await call('GET', '/projects/p-launch-broadcast/attention', undefined, { 'x-tenant-id': NOOR })).json
  assert.ok(attention.asks.some((a: any) => a.function === 'liability' && /Approve the effect envelope/.test(a.label)))
})

test('the postmortem library stages the changeset (v2 with a review delta), the registry stages the tier-1 midpoint', async () => {
  const pm = (await call('GET', '/projects/p-postmortem-library/contributions', undefined, { 'x-tenant-id': GRACE })).json[0]
  assert.equal(pm.changeset.length, 2, 'append-only v1 and v2 both survive')
  assert.ok(pm.events.some((e: any) => e.kind === 'crystallized' && /vs v1/.test(e.body)), 'the review delta rides the timeline')
  assert.equal(pm.status, 'landed')

  const reg = (await call('GET', '/projects/p-experiment-registry/contributions', undefined, { 'x-tenant-id': MAYA })).json
  assert.ok(reg.some((c: any) => c.status === 'landed'))
  const pending = reg.find((c: any) => c.status === 'open')
  assert.equal(pending.tier.level, 1)
  assert.notEqual(pending.reviewedVersion, pending.changeset.length, 'awaiting its review — the contributor’s error-catching ask')
})

test('the macro commons stages delegation: a drafted decision AND an effectful escalation, roster visible', async () => {
  const roster = (await call('GET', '/projects/p-macro-commons/delegations', undefined, { 'x-tenant-id': ADA })).json
  assert.equal(roster.length, 1)
  assert.equal(roster[0].mode, 'draft')
  const list = (await call('GET', '/projects/p-macro-commons/contributions', undefined, { 'x-tenant-id': OMAR })).json
  const kinds = list.flatMap((c: any) => c.events.map((e: any) => e.kind))
  assert.ok(kinds.includes('delegated-draft'), 'the delegate drafted the monotonic approval')
  assert.ok(kinds.includes('delegated-escalation'), 'the effectful macro escalated back to the human — the floor is not delegable')
})

test('the reading circle stages visible intents; the token garden stages the aftermath; the atelier stages harnesses', async () => {
  const holds = (await call('GET', '/projects/p-reading-circle/subgoals', undefined, { 'x-tenant-id': REI })).json
  assert.equal(holds.length, 2)
  assert.ok(holds.every((s: any) => typeof s.expiresAt === 'number'), 'each intent carries its visible lease')

  const tg = (await call('GET', '/projects/p-token-garden/contributions', undefined, { 'x-tenant-id': NOOR })).json[0]
  assert.equal(tg.status, 'landed')
  assert.equal(tg.events.at(-1).kind, 'note', 'the thread accrued AFTER landing (CW7)')
  assert.match(tg.events.at(-1).body, /Aftermath/)

  const ra = (await call('GET', '/projects/p-release-atelier/contributions', undefined, { 'x-tenant-id': GRACE })).json[0]
  const harnesses = ra.envelope.lines.map((l: any) => l.harness).sort()
  assert.deepEqual(harnesses, ['cooling-window', 'hold-until-landing'])
  assert.equal(ra.envelope.lines.find((l: any) => l.harness === 'cooling-window').used, 1)
})

test('the dictionary pairs open work with a declared contribution; the trailhead stages the stranger tier', async () => {
  const work = (await call('GET', '/projects/p-data-dictionary/open-subgoals', undefined, { 'x-tenant-id': MAYA })).json
  assert.ok(work.some((o: any) => o.subGoal === 'define: weekly-active-teams'))
  const dict = (await call('GET', '/projects/p-data-dictionary/contributions', undefined, { 'x-tenant-id': MAYA })).json
  assert.equal(dict[0].subGoal, 'define: activation-event')

  const ot = (await call('GET', '/projects/p-onboarding-trailhead/contributions', undefined, { 'x-tenant-id': OMAR })).json[0]
  assert.equal(ot.tier.level, 1, 'a first-time contributor reads Tier 1 by arithmetic, not suspicion')
})
