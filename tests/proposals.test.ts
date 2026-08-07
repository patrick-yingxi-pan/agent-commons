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

test('the ONE landing ledger: contributions and proposals share a project’s L# sequence', async () => {
  // The Changes/Improvements consolidation (2026-07-21): both landing paths on
  // a project draw one-past-the-highest across BOTH ledgers, so the merged
  // Changes panel reads as a single monotonic history — never two parallel L1s.
  const { projectId, subject } = await arena('propose')
  const c1 = await call('POST', `/projects/${projectId}/contributions`, { title: 'groundwork' }, { 'x-tenant-id': OWNER })
  const cl1 = await call('POST', `/projects/${projectId}/contributions/${c1.json.id}/land`, undefined, { 'x-tenant-id': OWNER })
  assert.equal(cl1.status, 200)
  assert.equal(cl1.json.landingNumber, 1, 'the contribution opens the shared ledger at L1')

  const offered = await call(
    'POST', '/proposals',
    { subject, delta: { kind: 'suggestion', text: 'Polish the readout' }, rationale: 'Rough edges.' },
    { 'x-tenant-id': AUDIENCE },
  )
  const pl = await call('POST', `/proposals/${offered.json.id}/land`, undefined, { 'x-tenant-id': OWNER })
  assert.equal(pl.status, 200)
  assert.equal(pl.json.landingNumber, 2, 'the proposal CONTINUES the sequence — not a parallel L1')

  const c2 = await call('POST', `/projects/${projectId}/contributions`, { title: 'follow-up' }, { 'x-tenant-id': OWNER })
  const cl2 = await call('POST', `/projects/${projectId}/contributions/${c2.json.id}/land`, undefined, { 'x-tenant-id': OWNER })
  assert.equal(cl2.json.landingNumber, 3, 'and the next contribution continues past the proposal')
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

test('SOCIAL-7: a schedule-patch delta lands by running the REAL updateSchedule', async () => {
  // The second APPLYING delta kind. Its value is that landing is not a record of
  // agreement — it is the same mutator the owner's own editor calls.
  const taskId = 's-issue-triage'
  const before = store.listSchedules(store.defaultTenantId()).find((t) => t.id === taskId)
  assert.ok(before, 'a seeded routine to improve')

  // Shared at `propose` so the audience may offer.
  store.createGrant(
    { subject: { kind: 'schedule', id: taskId }, audience: { kind: 'org', orgId: AUDIENCE }, tier: 'propose' },
    store.defaultTenantId(),
  )
  // …and the grant OPENS it: a routine is a subject like any other (SOCIAL-4 was
  // wired for projects and sessions only — a shared routine was readable by nobody).
  assert.ok(
    store.listSchedules(AUDIENCE).some((t) => t.id === taskId),
    'the granted audience can now see the routine',
  )
  assert.equal(store.listSchedules(AUDIENCE).find((t) => t.id === taskId)?.own, false, '…without owning it')

  const offered = await call(
    'POST', '/proposals',
    { subject: { kind: 'schedule', id: taskId }, delta: { kind: 'schedule-patch', patch: { cadence: 'Every 4 hours' } }, rationale: 'Two hours is noisy.' },
    { 'x-tenant-id': AUDIENCE },
  )
  assert.equal(offered.status, 200)

  // The audience may NOT edit the routine directly — read widened, write did not.
  assert.equal(
    (await call('PATCH', `/schedules/${taskId}`, { cadence: 'Every 4 hours' }, { 'x-tenant-id': AUDIENCE })).status,
    404,
    'a granted reader cannot patch, run or delete — and the refusal hides existence',
  )

  // The OWNER lands it, and the routine actually changes.
  const landed = await call('POST', `/proposals/${offered.json.id}/land`, undefined, { 'x-tenant-id': store.defaultTenantId() })
  assert.equal(landed.status, 200)
  assert.equal(landed.json.state, 'landed')
  assert.equal(
    store.listSchedules(store.defaultTenantId()).find((t) => t.id === taskId)?.cadence,
    'Every 4 hours',
    'landing ran the real mutator',
  )
})

test('SOCIAL-7: a schedule-patch that could not apply is REFUSED at the door (INV-9)', async () => {
  const bad: unknown[] = [
    { kind: 'schedule-patch', patch: {} }, // empty — would land as a no-op consuming an L#
    { kind: 'schedule-patch', patch: { steps: [] } }, // not a proposable field
    { kind: 'schedule-patch', patch: { cadence: '   ' } }, // blank
    { kind: 'schedule-patch', patch: { enabled: 'yes' } }, // wrong type
  ]
  for (const delta of bad) {
    const out = await call(
      'POST', '/proposals',
      { subject: { kind: 'schedule', id: 's-issue-triage' }, delta, rationale: 'because' },
      { 'x-tenant-id': store.defaultTenantId() },
    )
    assert.equal(out.status, 400, `refused: ${JSON.stringify(delta)}`)
  }
  // …and the kind only makes sense on a routine.
  const wrongSubject = await call(
    'POST', '/proposals',
    { subject: { kind: 'project', id: 'p-insights' }, delta: { kind: 'schedule-patch', patch: { cadence: 'Daily' } }, rationale: 'no' },
    { 'x-tenant-id': store.defaultTenantId() },
  )
  assert.equal(wrongSubject.status, 400, 'a delta that cannot apply to its subject is malformed')
})

/** ── SOCIAL-7: `artifact-patch`, the THIRD applying delta kind ───────────────
 *  The one remaining S3 delta. Its point is that "improve a resource" finally
 *  means changing a document's CONTENT, and that landing runs the very mutator
 *  the owner's own editor calls — never a parallel write path. The address is a
 *  BLOCK INDEX, not a line range, because these bodies are structured
 *  (contract/content.ts `docBlockText` states the cut). */
test('SOCIAL-7: an artifact-patch delta lands by running the REAL body mutator', async () => {
  const artifactId = 'a1' // insights-onepager.md — block 1 is a paragraph
  const owner = store.defaultTenantId()
  const before = store.artifactBlockText(artifactId, 1)
  assert.ok(before, 'a seeded document with an addressable prose block')

  // Shared at `propose` so the audience may offer — the SOCIAL-4 read widening
  // for artifacts is what makes the whole social surface reachable here.
  store.createGrant(
    { subject: { kind: 'artifact', id: artifactId }, audience: { kind: 'org', orgId: AUDIENCE }, tier: 'propose' },
    owner,
  )
  assert.ok(store.listArtifacts(AUDIENCE).some((a) => a.id === artifactId), 'the grant opens the artifact')
  assert.equal(store.listArtifacts(AUDIENCE).find((a) => a.id === artifactId)?.own, false, '…without owning it')

  const text = 'One screen, filterable, shareable — and now honestly rewritten.'
  const offered = await call(
    'POST', '/proposals',
    { subject: { kind: 'artifact', id: artifactId }, delta: { kind: 'artifact-patch', block: 1, text }, rationale: 'Tighter.' },
    { 'x-tenant-id': AUDIENCE },
  )
  assert.equal(offered.status, 200)
  // The diff's before-side is resolved at SERVE time, so a reviewer always sees
  // what landing would really replace.
  assert.equal(offered.json.deltaBase, before, 'the wire face carries the current base')

  // The audience may NOT rewrite the body directly — the read widened, the write did not.
  assert.equal(
    (await call('PATCH', `/artifacts/${artifactId}/content`, { block: 1, text }, { 'x-tenant-id': AUDIENCE })).status,
    404,
    'a granted reader cannot edit the body — and the refusal hides existence',
  )

  // The OWNER lands it, and the document actually changes.
  const landed = await call('POST', `/proposals/${offered.json.id}/land`, undefined, { 'x-tenant-id': owner })
  assert.equal(landed.status, 200)
  assert.equal(landed.json.state, 'landed')
  assert.equal(store.artifactBlockText(artifactId, 1), text, 'landing ran the real mutator')

  // …and the change is what the READERS see: the name-keyed library the previews
  // render carries it for the owner AND the granted audience, nobody else.
  assert.match(JSON.stringify(store.artifactContent(owner)['insights-onepager.md']), /honestly rewritten/)
  assert.match(JSON.stringify(store.artifactContent(AUDIENCE)['insights-onepager.md']), /honestly rewritten/)
  assert.doesNotMatch(
    JSON.stringify(store.artifactContent(BYSTANDER)['insights-onepager.md']),
    /honestly rewritten/,
    'a bystander still reads the authored fixture — the overlay is per-caller',
  )

  // Restore, so the seeded demo world is unchanged for other suites.
  store.updateArtifactBlock(artifactId, 1, before)
})

test('SOCIAL-7: the owner’s own body-edit door runs the same mutator (one write path)', async () => {
  const owner = store.defaultTenantId()
  const before = store.artifactBlockText('a2', 1)
  assert.ok(before)
  const out = await call('PATCH', '/artifacts/a2/content', { block: 1, text: 'Owner-edited copy.' }, { 'x-tenant-id': owner })
  assert.equal(out.status, 200)
  assert.equal(store.artifactBlockText('a2', 1), 'Owner-edited copy.', 'the owner needs no consent from themselves')
  store.updateArtifactBlock('a2', 1, before)
})

test('SOCIAL-7: an artifact-patch that could not apply is REFUSED at the door (INV-9)', async () => {
  const owner = store.defaultTenantId()
  const bad: [string, unknown, string][] = [
    ['non-doc body (a figure has nothing ordered)', { kind: 'artifact-patch', block: 0, text: 'x' }, 'a4'],
    ['a block with no single editable string (an email header)', { kind: 'artifact-patch', block: 0, text: 'x' }, 'a3'],
    ['a list block — `ul` holds many strings, not one', { kind: 'artifact-patch', block: 3, text: 'x' }, 'a1'],
    ['index out of range', { kind: 'artifact-patch', block: 99, text: 'x' }, 'a1'],
    ['a negative index', { kind: 'artifact-patch', block: -1, text: 'x' }, 'a1'],
    ['blank text', { kind: 'artifact-patch', block: 1, text: '   ' }, 'a1'],
    ['text IDENTICAL to the block — a no-op that would still burn an L#', { kind: 'artifact-patch', block: 1, text: store.artifactBlockText('a1', 1) }, 'a1'],
  ]
  for (const [why, delta, id] of bad) {
    const out = await call(
      'POST', '/proposals',
      { subject: { kind: 'artifact', id }, delta, rationale: 'because' },
      { 'x-tenant-id': owner },
    )
    assert.equal(out.status, 400, `refused: ${why}`)
  }
  // …and the kind only makes sense on an artifact.
  const wrongSubject = await call(
    'POST', '/proposals',
    { subject: { kind: 'project', id: 'p-insights' }, delta: { kind: 'artifact-patch', block: 0, text: 'x' }, rationale: 'no' },
    { 'x-tenant-id': owner },
  )
  assert.equal(wrongSubject.status, 400, 'a delta that cannot apply to its subject is malformed')
})

test('SOCIAL-7: the body overlay keys on artifact ID, never the library’s file name', async () => {
  // The S7 lesson generalized: preference may key on a name, AUTHORITY never may.
  // Two tenants can own artifacts with the SAME file name, and the content
  // library is name-keyed — so a name-keyed edit store would write one
  // workspace's revision into another's document.
  const owner = store.defaultTenantId()
  const name = 'insights-onepager.md'
  const mine = store.listArtifacts(owner).find((a) => a.name === name)
  assert.ok(mine, 'the flagship document')

  // A second tenant creates an artifact with the very same name. (A created
  // artifact lives in the relation GRAPH, not the seeded set — which is exactly
  // why the body-edit route resolves through `artifactById` across both homes.)
  const g = store.applyRelationOp(
    { kind: 'save-artifact', artifact: { name, kind: 'doc', meta: 'Document' } },
    BYSTANDER,
  )
  const theirs = g.extraArtifacts.find((a) => a.name === name && a.id !== mine.id)
  assert.ok(theirs && theirs.id !== mine.id, 'a same-named artifact in another namespace')

  const before = store.artifactBlockText(mine.id, 1)
  assert.ok(before)
  store.updateArtifactBlock(mine.id, 1, 'Only the flagship copy changed.')
  assert.match(JSON.stringify(store.artifactContent(owner)[name]), /Only the flagship copy changed/)
  assert.doesNotMatch(
    JSON.stringify(store.artifactContent(BYSTANDER)[name] ?? {}),
    /Only the flagship copy changed/,
    'the same-named artifact in another namespace is untouched',
  )
  store.updateArtifactBlock(mine.id, 1, before)
})

test('SOCIAL-7: artifact.changed is gated to the artifact’s own read wall', () => {
  // A body edit names a document; the gate must mirror the artifact's read wall
  // so a granted audience refreshes and nobody else learns the name exists.
  const e = { type: 'artifact.changed', artifactId: 'a1', artifactName: 'insights-onepager.md' }
  assert.equal(store.eventVisibleToTenant(e, store.defaultTenantId()), true, 'the owner’s stream gets it')
  assert.equal(store.eventVisibleToTenant(e, 'tenant-no-such'), false, 'a stranger’s never does')
})

test('SOCIAL-7: a landed artifact-patch shows the pre-image it replaced, not the text it became', async () => {
  // Found in the running app: the diff's before-side was resolved live for
  // EVERY state, so the moment a proposal landed its own row re-rendered as
  // "− X / + X" — a no-op where a change had happened. An open row wants the
  // LIVE base (what landing would replace); a landed row is history and wants
  // the pre-image, frozen at the instant it applied.
  const owner = store.defaultTenantId()
  const before = store.artifactBlockText('a17', 1)
  assert.ok(before, 'a seeded document block')
  const text = 'Token-bucket per API key: 900 requests/minute, burst 150.'

  const offered = await call(
    'POST', '/proposals',
    { subject: { kind: 'artifact', id: 'a17' }, delta: { kind: 'artifact-patch', block: 1, text }, rationale: 'Raise the ceiling.' },
    { 'x-tenant-id': owner },
  )
  assert.equal(offered.status, 200)
  assert.equal(offered.json.deltaBase, before, 'while OPEN the base is live — what landing would replace')

  const landed = await call('POST', `/proposals/${offered.json.id}/land`, undefined, { 'x-tenant-id': owner })
  assert.equal(landed.status, 200)
  assert.equal(landed.json.deltaBase, before, 'once LANDED the base is the pre-image, frozen')
  assert.notEqual(landed.json.deltaBase, text, 'never a diff of the text against itself')

  // …and it STAYS the pre-image after the body moves on again.
  store.updateArtifactBlock('a17', 1, 'Rewritten again by the owner.')
  const reread = await call('GET', '/proposals?kind=artifact&id=a17', undefined, { 'x-tenant-id': owner })
  const row = reread.json.find((p) => p.id === offered.json.id)
  assert.equal(row.deltaBase, before, 'history does not drift with the live body')

  // The stored pre-image is not a wire field of its own.
  assert.equal('appliedBase' in row, false, 'it reaches the client only as deltaBase')

  store.updateArtifactBlock('a17', 1, before)
})

test('SOCIAL-7: an artifact-patch’s text is CLAMPED like every other stored free text', async () => {
  // Landing writes this string into a body that GET /artifact-content hands to
  // every reader of the document, so an unbounded delta is an unbounded
  // broadcast. The suggestion arm and the rationale were already clamped; this
  // one shipped without a cap (review finding).
  const owner = store.defaultTenantId()
  const before = store.artifactBlockText('a16', 0)
  assert.ok(before)
  const huge = 'x'.repeat(50_000)
  const offered = await call(
    'POST', '/proposals',
    { subject: { kind: 'artifact', id: 'a16' }, delta: { kind: 'artifact-patch', block: 0, text: huge }, rationale: 'long' },
    { 'x-tenant-id': owner },
  )
  assert.equal(offered.status, 200)
  assert.ok(offered.json.delta.text.length < huge.length, 'the STORED delta is clamped, not the raw string')
  assert.equal(offered.json.delta.text.length, 2000)

  await call('POST', `/proposals/${offered.json.id}/land`, undefined, { 'x-tenant-id': owner })
  assert.equal(store.artifactBlockText('a16', 0)?.length, 2000, 'and the body it wrote is clamped too')

  // The owner's own door shares the ceiling — one mutator, one bound.
  await call('PATCH', '/artifacts/a16/content', { block: 0, text: huge }, { 'x-tenant-id': owner })
  assert.equal(store.artifactBlockText('a16', 0)?.length, 2000)
  store.updateArtifactBlock('a16', 0, before)
})

test('SOCIAL-7: a same-named artifact in the SAME workspace never inherits a body edit', async () => {
  // The cross-tenant case was locked from the start; this is the same defect one
  // step in. The overlay is id-keyed, but the projection wrote it back under the
  // NAME — and one workspace can hold two artifacts called the same thing (the
  // save-artifact replay guard keys on name + SOURCE, so two sessions saving
  // `rate-limit-rfc.md` both land). Editing the real one then showed the
  // revision inside the impostor. The library now carries an exact ARTIFACT-ID
  // key that readers prefer, and lends the NAME key only while it picks out one.
  const owner = store.defaultTenantId()
  const name = 'rate-limit-rfc.md'
  const before = store.artifactBlockText('a17', 1)
  assert.ok(before, 'the seeded document')
  assert.ok(store.artifactContent(owner)[name], 'whose authored body is served under its name')

  const g = store.applyRelationOp(
    { kind: 'save-artifact', artifact: { name, kind: 'doc', meta: 'Document' }, sessionTitle: 'Another thread' },
    owner,
  )
  const impostor = g.extraArtifacts.find((a) => a.name === name)
  assert.ok(impostor && impostor.id !== 'a17', 'a second artifact wearing the same name, same workspace')

  store.updateArtifactBlock('a17', 1, 'Token-bucket per API key: rewritten for this test.')
  const lib = store.artifactContent(owner)
  assert.match(JSON.stringify(lib['a17']), /rewritten for this test/, 'the edit is served under the exact artifact id')
  assert.doesNotMatch(
    JSON.stringify(lib[name] ?? {}),
    /rewritten for this test/,
    'and never under a name two artifacts share — the impostor cannot inherit it',
  )
  store.updateArtifactBlock('a17', 1, before)
})
