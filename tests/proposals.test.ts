/** Social S3 — the Proposal entity (docs/design/social-layer.md §2.4).
 *  Invariants: the wall INHERITS the subject's (existence-hiding on every
 *  face); offering needs the propose tier (comment is not enough); the review
 *  thread is a normal Discussion anchored to the proposal, readable exactly
 *  where the subject is; landing is the subject OWNER's consent, assigns
 *  MONOTONIC per-subject ledger numbers, and APPLIES a relation-op delta
 *  through the real reducer; declining is owner-only and closed states are
 *  immutable; the wire face is redacted. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from '../server/store.ts'
import { call } from './helpers/http.ts'

const OWNER = 'tenant-prop-owner'
const BYSTANDER = 'tenant-prop-bystander'
const AUDIENCE = 'tenant-beta'
let n = 0

async function arena(tier: 'comment' | 'propose' = 'propose') {
  const projectId = `p-prop-${(n += 1)}`
  store.applyRelationOp({ kind: 'create-project', projectId, projectName: `Prop ${n}`, projectDescription: '' }, OWNER)
  const g = await call(
    'POST', '/grants',
    { subject: { kind: 'project', id: projectId }, audience: { kind: 'org', orgId: AUDIENCE }, tier },
    { 'x-tenant-id': OWNER },
  )
  assert.equal(g.status, 200)
  return { projectId, subject: { kind: 'project', id: projectId } }
}

test('offer: propose tier required; the review thread anchors to the proposal and inherits the subject wall', async () => {
  const { subject } = await arena('comment')
  const denied = await call(
    'POST', '/proposals',
    { subject, delta: { kind: 'suggestion', text: 'Tighten the intro' }, rationale: 'Reads long' },
    { 'x-tenant-id': AUDIENCE },
  )
  assert.equal(denied.status, 403, 'comment tier may talk, not propose')

  const { projectId, subject: s2 } = await arena('propose')
  const offered = await call(
    'POST', '/proposals',
    { subject: s2, delta: { kind: 'suggestion', text: 'Tighten the intro' }, rationale: 'Reads long — cut the second para.' },
    { 'x-tenant-id': AUDIENCE },
  )
  assert.equal(offered.status, 200)
  assert.equal(offered.json.state, 'offered')
  assert.equal(offered.json.mine, true)
  assert.equal(offered.json.offererTenant, undefined, 'raw offerer tenant never crosses')
  assert.ok(offered.json.discussionId, 'the review thread exists from birth')

  // The review thread is a NORMAL discussion anchored to the proposal — the
  // OWNER reads it (subject wall), a bystander 404s (existence-hiding).
  const asOwner = await call('GET', `/discussions/${offered.json.discussionId}`, undefined, { 'x-tenant-id': OWNER })
  assert.equal(asOwner.status, 200)
  assert.equal(asOwner.json.anchor.ref.kind, 'proposal')
  assert.equal(asOwner.json.posts[0].body, 'Reads long — cut the second para.', 'the rationale opened the thread')
  const asBystander = await call('GET', `/discussions/${offered.json.discussionId}`, undefined, { 'x-tenant-id': BYSTANDER })
  assert.equal(asBystander.status, 404)
  const ghostList = await call('GET', `/proposals?kind=project&id=${projectId}`, undefined, { 'x-tenant-id': BYSTANDER })
  assert.equal(ghostList.status, 404, 'the proposals list walls like the subject')
})

test('land: owner-only consent, monotonic per-subject L#, a relation-op delta actually applies', async () => {
  const { projectId, subject } = await arena('propose')
  // A relation-op delta the whole world can observe: flip the project shared.
  const offered = await call(
    'POST', '/proposals',
    {
      subject,
      delta: { kind: 'relation-op', op: { kind: 'share-project', projectId, projectName: `Prop ${n}`, shared: true } },
      rationale: 'Open this to the commons.',
    },
    { 'x-tenant-id': AUDIENCE },
  )
  assert.equal(offered.status, 200)
  const notOwner = await call('POST', `/proposals/${offered.json.id}/land`, undefined, { 'x-tenant-id': AUDIENCE })
  assert.equal(notOwner.status, 403, 'the offerer cannot land their own change — consent is the owner’s')

  const before = await call('GET', `/projects/${projectId}/contributions`, undefined, { 'x-tenant-id': BYSTANDER })
  assert.equal(before.status, 404, 'pre-land, a bystander cannot see the project')
  const landed = await call('POST', `/proposals/${offered.json.id}/land`, undefined, { 'x-tenant-id': OWNER })
  assert.equal(landed.status, 200)
  assert.equal(landed.json.state, 'landed')
  assert.equal(landed.json.landingNumber, 1, 'L1 — the subject’s ledger starts')
  const after = await call('GET', `/projects/${projectId}/contributions`, undefined, { 'x-tenant-id': BYSTANDER })
  assert.equal(after.status, 200, 'the landed relation-op APPLIED: the project is shared now')

  const relanded = await call('POST', `/proposals/${offered.json.id}/land`, undefined, { 'x-tenant-id': OWNER })
  assert.equal(relanded.status, 409, 'a landed proposal is immutable history')

  const second = await call(
    'POST', '/proposals',
    { subject, delta: { kind: 'suggestion', text: 'Rename the readout' }, rationale: 'Clearer name.' },
    { 'x-tenant-id': AUDIENCE },
  )
  const landed2 = await call('POST', `/proposals/${second.json.id}/land`, undefined, { 'x-tenant-id': OWNER })
  assert.equal(landed2.json.landingNumber, 2, 'L2 — monotonic per subject')
  const list = await call('GET', `/proposals?kind=project&id=${projectId}`, undefined, { 'x-tenant-id': OWNER })
  assert.deepEqual(list.json.map((p: any) => p.landingNumber), [2, 1], 'ledger read: landed L{n} descending')
})

test('S5 bells: the share rings the audience, the offer rings the owner, the verdict rings the offerer', async () => {
  const { projectId, subject } = await arena('propose')
  // arena() granted AUDIENCE with no note — still a bell: access arrived.
  assert.ok(
    store.listNotifications(AUDIENCE).some((x) => x.kind === 'social.shared' && x.subjectId === projectId),
    'the audience’s inbox carries the share',
  )
  const offered = await call(
    'POST', '/proposals',
    { subject, delta: { kind: 'suggestion', text: 'Trim it' }, rationale: 'Long.' },
    { 'x-tenant-id': AUDIENCE },
  )
  assert.ok(
    store.listNotifications(OWNER).some((x) => x.kind === 'social.offered' && x.subjectId === projectId),
    'the owner’s inbox carries the offer',
  )
  await call('POST', `/proposals/${offered.json.id}/decline`, undefined, { 'x-tenant-id': OWNER })
  assert.ok(
    store.listNotifications(AUDIENCE).some((x) => x.kind === 'social.declined' && x.subjectId === projectId),
    'the offerer’s inbox carries the verdict',
  )
})

test('decline: owner-only, polite, and terminal; the rationale-less offer is refused at the funnel', async () => {
  const { subject } = await arena('propose')
  const bad = await call('POST', '/proposals', { subject, delta: { kind: 'suggestion', text: 'x' } }, { 'x-tenant-id': AUDIENCE })
  assert.equal(bad.status, 400, 'a rationale is required — an unargued change is noise')
  const offered = await call(
    'POST', '/proposals',
    { subject, delta: { kind: 'suggestion', text: 'Drop the appendix' }, rationale: 'Unused.' },
    { 'x-tenant-id': AUDIENCE },
  )
  const declined = await call('POST', `/proposals/${offered.json.id}/decline`, undefined, { 'x-tenant-id': OWNER })
  assert.equal(declined.status, 200)
  assert.equal(declined.json.state, 'declined')
  const reland = await call('POST', `/proposals/${offered.json.id}/land`, undefined, { 'x-tenant-id': OWNER })
  assert.equal(reland.status, 409, 'declined is terminal')
  const probe = await call('GET', `/proposals/${offered.json.id}`, undefined, { 'x-tenant-id': BYSTANDER })
  assert.equal(probe.status, 404, 'to third parties the whole lifecycle is the same 404')
})
