/** The contribution ledger, Phase A (docs/design/agent-contribution-workflow.md —
 *  CW1 declared intents visible / CW6 the linear landing ledger / CW7 the page
 *  keeps accruing). The invariants under test: visibility mirrors the Project's
 *  (owner or shared ⇒ readable, else the existence-hiding 404); the wire face is
 *  redacted (display names + principal kinds, never raw foreign tenant ids);
 *  landing is contributor-or-owner only and assigns MONOTONIC per-project ledger
 *  numbers derived from the ledger itself; a landed contribution is immutable
 *  history (no re-land) whose discussion stays OPEN (aftermath accrues); and
 *  free text is trimmed + capped at the funnel. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from '../store/index.ts'
import { call, callFresh } from '../testkit/http.ts'
import { delegationCreationId } from '../delegationCreationIdentity.ts'
import { delegationRevocationId } from '../delegationRevocationIdentity.ts'
import { delegatedJudgmentId } from '../delegatedJudgmentIdentity.ts'
import { contributionCreationId } from '../contributionCreationIdentity.ts'
import { contributionEffectExecutionId } from '../contributionEffectExecutionIdentity.ts'
import { contributionCrystallizationId } from '../contributionCrystallizationIdentity.ts'
import { contributionEnvelopeApprovalId } from '../contributionEnvelopeApprovalIdentity.ts'
import { contributionEnvelopeProposalId } from '../contributionEnvelopeProposalIdentity.ts'
import { contributionCommentCreationId } from '../contributionCommentCreationIdentity.ts'
import { contributionReviewId } from '../contributionReviewIdentity.ts'
import { contributionReviewRequirementId } from '../contributionReviewRequirementIdentity.ts'
import { SELF_PROJECT_HOLDER } from '../../contract/index.ts'

const A = 'tenant-contrib-A' // project owner
const B = 'tenant-contrib-B' // contributor
const C = 'tenant-contrib-C' // bystander (sees, comments; may NOT land)
let n = 0

test('no ceremony friction anywhere: window.confirm/alert/prompt never ship (CW9 — friction lives in the substance)', async () => {
  // The design rule: a ritual ask carries SUBSTANTIVE friction (read the
  // draft, see the envelope) — never a browser confirm/alert stacking that
  // habituates away the attention it means to summon. Sweepable funnel rule.
  const { readdirSync, readFileSync, statSync } = await import('node:fs')
  const { join } = await import('node:path')
  const offenders: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.(ts|tsx)$/.test(name)) {
        const src = readFileSync(p, 'utf8')
        if (/window\.confirm\(|window\.alert\(|window\.prompt\(|[^.\w]alert\(/.test(src)) offenders.push(p)
      }
    }
  }
  walk(join(process.cwd(), 'src'))
  assert.deepEqual(offenders, [], 'ceremony dialogs found — friction must live in the substance or not at all')
})

/** A shared project owned by A with one open contribution declared by B. */
async function arena() {
  const projectId = `p-contrib-${(n += 1)}`
  store.applyRelationOp({ kind: 'create-project', projectId, projectName: `Ledger ${n}`, projectDescription: '' }, A)
  store.applyRelationOp({ kind: 'share-project', projectId, projectName: `Ledger ${n}`, shared: true }, A)
  const opened = await call(
    'POST', `/projects/${projectId}/contributions`,
    { title: `  Contribution ${n}  `, summary: 'What changes, and why.', subGoal: `goal-${n}` },
    { 'x-tenant-id': B },
  )
  assert.equal(opened.status, 200)
  return { projectId, cid: opened.json.id as string, opened: opened.json }
}

test('open: declared by any viewer, trimmed, redacted, with the opened event on the timeline', async () => {
  const { projectId, cid, opened } = await arena()
  assert.equal(opened.title, `Contribution ${n}`, 'trimmed at the funnel')
  assert.equal(opened.status, 'open')
  assert.equal(opened.contributor, B, 'attribution is the public display name')
  assert.equal(opened.contributorTenant, undefined, 'the raw tenant id never crosses the wire')
  assert.equal(opened.landingNumber, undefined, 'an open contribution has no place in history yet (INV-9)')
  assert.equal(opened.events.length, 1)
  assert.equal(opened.events[0].kind, 'opened')
  assert.equal(opened.events[0].actor, B)

  const list = await call('GET', `/projects/${projectId}/contributions`, undefined, { 'x-tenant-id': C })
  assert.equal(list.status, 200, 'a shared ledger reads for any tenant')
  assert.equal(list.json.find((c: any) => c.id === cid).contributorPrincipal, undefined, 'principals stay server-private')
  // The viewer-relative `mine` stamp: raw-id comparison SERVER-side, boolean on
  // the wire — display names aren't unique, so the client must never infer
  // "yours" from a name (the projects `own` pattern).
  assert.equal(list.json.find((c: any) => c.id === cid).mine, undefined, 'a bystander is not the contributor')
  const asB = await call('GET', `/projects/${projectId}/contributions`, undefined, { 'x-tenant-id': B })
  assert.equal(asB.json.find((c: any) => c.id === cid).mine, true, 'the contributor sees their own stamp')

  // A caller-supplied session id is stored ONLY when the opener's tenant can
  // see that session — a foreign private session id must not ride the public
  // ledger as a leaked identifier (review finding).
  const ghostSession = await call(
    'POST', `/projects/${projectId}/contributions`,
    { title: 'ghost session door', sessionId: 's-not-mine' },
    { 'x-tenant-id': B },
  )
  assert.equal(ghostSession.json.sessionId, undefined, 'an unseeable session id is dropped at the funnel')

  const untitled = await call('POST', `/projects/${projectId}/contributions`, { summary: 'no title' }, { 'x-tenant-id': B })
  assert.equal(untitled.status, 400)
})

test('the ledger wall IS the project wall: a foreign private project 404s everywhere; ghosts 404', async () => {
  const privId = `p-contrib-priv-${(n += 1)}`
  store.applyRelationOp({ kind: 'create-project', projectId: privId, projectName: 'Private ledger', projectDescription: '' }, A)
  const mine = await call('POST', `/projects/${privId}/contributions`, { title: 'owner-only' }, { 'x-tenant-id': A })
  assert.equal(mine.status, 200, 'the owner uses a private ledger normally')

  for (const [method, path, body] of [
    ['GET', `/projects/${privId}/contributions`, undefined],
    ['POST', `/projects/${privId}/contributions`, { title: 'x' }],
    ['POST', `/projects/${privId}/contributions/${mine.json.id}/comments`, { body: 'hi' }],
    ['POST', `/projects/${privId}/contributions/${mine.json.id}/land`, undefined],
    ['POST', `/projects/${privId}/contributions/${mine.json.id}/require-review`, undefined],
  ] as const) {
    const res = await call(method, path, body, { 'x-tenant-id': B })
    assert.equal(res.status, 404, `${method} ${path}: a project you cannot see answers like one that does not exist`)
  }

  const { projectId } = await arena()
  const ghost = await call('POST', `/projects/${projectId}/contributions/contrib-no-such/land`, undefined, { 'x-tenant-id': A })
  assert.equal(ghost.status, 404)
})

test('landing: bystander 403; contributor lands; numbers are per-project monotonic; re-land 409', async () => {
  const one = await arena()
  const bystander = await call('POST', `/projects/${one.projectId}/contributions/${one.cid}/land`, undefined, { 'x-tenant-id': C })
  assert.equal(bystander.status, 403, 'seeing is not landing')

  // CW5 (Phase E): a first-time contributor is Tier 1 — the self-land is
  // refused until the adversarial review covers the latest crystallized
  // version. The full path: refused → crystallize → review → lands.
  const early = await call('POST', `/projects/${one.projectId}/contributions/${one.cid}/land`, undefined, { 'x-tenant-id': B })
  assert.equal(early.status, 409, 'Tier 1 — no review yet, no self-land')
  await call('POST', `/projects/${one.projectId}/contributions/${one.cid}/changeset`,
    { entries: [{ kind: 'note', target: 'plan', after: 'done' }] }, { 'x-tenant-id': B })
  const reviewed = await call('POST', `/projects/${one.projectId}/contributions/${one.cid}/review`, undefined, { 'x-tenant-id': B })
  assert.equal(reviewed.status, 200)
  assert.equal(reviewed.json.reviewedVersion, 1)
  assert.equal(reviewed.json.events.at(-1).kind, 'review-passed')
  const landed = await call('POST', `/projects/${one.projectId}/contributions/${one.cid}/land`, undefined, { 'x-tenant-id': B })
  assert.equal(landed.status, 200)
  assert.equal(landed.json.status, 'landed')
  assert.equal(landed.json.landingNumber, 1, 'the project ledger opens at L1')
  assert.equal(landed.json.landedBy, B)
  const lastEvent = landed.json.events.at(-1)
  assert.equal(lastEvent.kind, 'landed')

  const again = await call('POST', `/projects/${one.projectId}/contributions/${one.cid}/land`, undefined, { 'x-tenant-id': B })
  assert.equal(again.status, 409, 'a landed contribution is immutable history')

  // The OWNER may land a contributor's work; the number advances monotonically.
  const second = await call('POST', `/projects/${one.projectId}/contributions`, { title: 'second' }, { 'x-tenant-id': B })
  const ownerLands = await call('POST', `/projects/${one.projectId}/contributions/${second.json.id}/land`, undefined, { 'x-tenant-id': A })
  assert.equal(ownerLands.status, 200)
  assert.equal(ownerLands.json.landingNumber, 2, 'monotonic within the project')

  // A DIFFERENT project's ledger counts independently — the number is a
  // per-project position, not a global counter.
  const other = await arena()
  // (Owner lands — B's record is per-project, so B is Tier 1 again HERE: the
  // trust input is itself project-scoped, which this line quietly locks.)
  const otherLanded = await call('POST', `/projects/${other.projectId}/contributions/${other.cid}/land`, undefined, { 'x-tenant-id': A })
  assert.equal(otherLanded.json.landingNumber, 1)

  // The ledger read: open band first, then landed in reverse ledger order.
  const third = await call('POST', `/projects/${one.projectId}/contributions`, { title: 'still open' }, { 'x-tenant-id': C })
  const list = (await call('GET', `/projects/${one.projectId}/contributions`, undefined, { 'x-tenant-id': A })).json
  assert.equal(list[0].id, third.json.id, 'open first')
  assert.deepEqual(list.slice(1).map((c: any) => c.landingNumber), [2, 1], 'landed newest-first (L descending)')
})

test('a keyed landing replays current ledger truth after response-cache loss without repeating the transition', async () => {
  const { projectId, cid } = await arena()
  const key = `contribution-land-${n}`
  const headers = { 'x-tenant-id': A, 'idempotency-key': key }

  const landed = await call('POST', `/projects/${projectId}/contributions/${cid}/land`, undefined, headers)
  assert.equal(landed.status, 200)
  assert.equal(landed.json.status, 'landed')
  assert.equal(landed.json.landingNumber, 1)
  assert.equal(landed.json.landingId, undefined, 'the private operation identity never crosses the wire')
  assert.equal(landed.json.landedByTenant, undefined, 'the raw landing authority never crosses the wire')

  const noted = await call(
    'POST',
    `/projects/${projectId}/contributions/${cid}/comments`,
    { body: 'Aftermath added after the landing acknowledgement was serialized.' },
    { 'x-tenant-id': B },
  )
  assert.equal(noted.status, 200)
  const durableReplay = await callFresh(
    'POST',
    `/projects/${projectId}/contributions/${cid}/land`,
    undefined,
    headers,
  )
  assert.equal(durableReplay.status, 200)
  assert.equal(durableReplay.headers['idempotency-replayed'], undefined)
  assert.equal(durableReplay.json.landingNumber, 1, 'the ledger position is assigned once')
  assert.equal(durableReplay.json.events.filter((event: any) => event.kind === 'landed').length, 1)
  assert.equal(durableReplay.json.events.at(-1).body, 'Aftermath added after the landing acknowledgement was serialized.',
    'durable replay serves current history rather than a stale response envelope')

  const changedKey = await callFresh(
    'POST',
    `/projects/${projectId}/contributions/${cid}/land`,
    undefined,
    { ...headers, 'idempotency-key': `${key}-changed` },
  )
  assert.equal(changedKey.status, 409, 'another logical act cannot claim the completed landing')
  const otherTenant = await callFresh(
    'POST',
    `/projects/${projectId}/contributions/${cid}/land`,
    undefined,
    { 'x-tenant-id': B, 'idempotency-key': key },
  )
  assert.equal(otherTenant.status, 409, 'the same raw key in another tenant scope cannot claim the operation')
})

test('notes: any viewer, trimmed + capped, and the thread stays open AFTER landing (CW7)', async () => {
  const { projectId, cid } = await arena()
  const noted = await call('POST', `/projects/${projectId}/contributions/${cid}/comments`, { body: '  looks right  ' }, { 'x-tenant-id': C })
  assert.equal(noted.status, 200)
  const note = noted.json.events.find((e: any) => e.kind === 'note')
  assert.equal(note.body, 'looks right', 'trimmed')
  assert.equal(note.actor, C)

  await call('POST', `/projects/${projectId}/contributions/${cid}/land`, undefined, { 'x-tenant-id': A })
  const after = await call('POST', `/projects/${projectId}/contributions/${cid}/comments`, { body: 'aftermath: verified in prod' }, { 'x-tenant-id': A })
  assert.equal(after.status, 200, 'a landed contribution keeps accruing — the aftermath is part of its story')
  const events = after.json.events
  assert.equal(events.at(-1).kind, 'note')
  assert.ok(events.some((e: any) => e.kind === 'landed'), 'the landed transition stays in the record')

  const empty = await call('POST', `/projects/${projectId}/contributions/${cid}/comments`, { body: '   ' }, { 'x-tenant-id': B })
  assert.equal(empty.status, 400)
  const long = await call('POST', `/projects/${projectId}/contributions/${cid}/comments`, { body: 'x'.repeat(5000) }, { 'x-tenant-id': B })
  assert.equal(long.json.events.at(-1).body.length, 2000, 'per-note cap')
})

test('a keyed Contribution comment owns exact prose and replays current history beyond response-cache loss', async () => {
  const { projectId, cid } = await arena()
  const key = `contribution-comment-${n}`
  const headers = { 'x-tenant-id': C, 'idempotency-key': key }
  const expectedId = contributionCommentCreationId(C, projectId, cid, key)
  const body = '  keep this exact review note  '

  const first = await call(
    'POST',
    `/projects/${projectId}/contributions/${cid}/comments`,
    { body },
    headers,
  )
  assert.equal(first.status, 200)
  const receipt = first.json.events.find((event: any) => event.id === expectedId)
  assert.equal(receipt.kind, 'note')
  assert.equal(receipt.body, 'keep this exact review note')
  assert.equal(receipt.notedByTenant, undefined, 'the raw replay authority stays private')

  await call('POST', `/projects/${projectId}/contributions/${cid}/land`, undefined, { 'x-tenant-id': A })
  for (let i = 0; i < 99; i += 1) {
    assert.equal(typeof store.noteContribution(projectId, cid, `later ${i}`, A, undefined), 'object')
  }
  const replay = await callFresh(
    'POST',
    `/projects/${projectId}/contributions/${cid}/comments`,
    { body },
    headers,
  )
  assert.equal(replay.status, 200, 'exact durable truth precedes the now-full discussion cap')
  assert.equal(replay.json.status, 'landed', 'replay returns the containing Contribution’s current lifecycle')
  assert.equal(replay.json.events.at(-1).body, 'later 98', 'later timeline history is retained')
  assert.equal(replay.json.events.filter((event: any) => event.id === expectedId).length, 1)

  const redirected = await callFresh(
    'POST',
    `/projects/${projectId}/contributions/${cid}/comments`,
    { body: 'different retry prose' },
    headers,
  )
  assert.equal(redirected.status, 400, 'one logical key cannot be redirected to different public prose')
  const fresh = await callFresh(
    'POST',
    `/projects/${projectId}/contributions/${cid}/comments`,
    { body: 'one too many' },
    { 'x-tenant-id': C, 'idempotency-key': `${key}-fresh` },
  )
  assert.equal(fresh.status, 409, 'a distinct new comment still observes the cap')
})

test('a keyed Contribution review owns one exact changeset version across cache loss and later history', async () => {
  const { projectId, cid } = await arena()
  await call(
    'POST',
    `/projects/${projectId}/contributions/${cid}/changeset`,
    { entries: [{ kind: 'note', target: 'review target', after: 'v1' }] },
    { 'x-tenant-id': B },
  )
  const key = `contribution-review-${n}`
  const headers = { 'x-tenant-id': B, 'idempotency-key': key }
  const expectedId = contributionReviewId(B, projectId, cid, key)
  const first = await call(
    'POST',
    `/projects/${projectId}/contributions/${cid}/review`,
    { expectedVersion: 1 },
    headers,
  )
  assert.equal(first.status, 200)
  const receipt = first.json.events.find((event: any) => event.id === expectedId)
  assert.equal(receipt.kind, 'review-passed')
  assert.equal(receipt.reviewedVersion, 1)
  assert.equal(receipt.reviewedByTenant, undefined, 'the raw review authority stays private')

  await call(
    'POST',
    `/projects/${projectId}/contributions/${cid}/changeset`,
    { entries: [{ kind: 'note', target: 'review target', after: 'v2' }] },
    { 'x-tenant-id': B },
  )
  await call(
    'POST',
    `/projects/${projectId}/contributions/${cid}/comments`,
    { body: 'history after the reviewed version' },
    { 'x-tenant-id': C },
  )
  const replay = await callFresh(
    'POST',
    `/projects/${projectId}/contributions/${cid}/review`,
    { expectedVersion: 1 },
    headers,
  )
  assert.equal(replay.status, 200, 'exact durable review truth precedes the now-stale version gate')
  assert.equal(replay.json.changeset.length, 2, 'replay returns the current containing Contribution')
  assert.equal(replay.json.events.at(-1).body, 'history after the reviewed version')
  assert.equal(replay.json.events.filter((event: any) => event.id === expectedId).length, 1)

  const redirected = await callFresh(
    'POST',
    `/projects/${projectId}/contributions/${cid}/review`,
    { expectedVersion: 2 },
    headers,
  )
  assert.equal(redirected.status, 400, 'one logical key cannot be redirected to another changeset version')
  const stale = await callFresh(
    'POST',
    `/projects/${projectId}/contributions/${cid}/review`,
    { expectedVersion: 1 },
    { 'x-tenant-id': B, 'idempotency-key': `${key}-fresh` },
  )
  assert.equal(stale.status, 409, 'a fresh review must name the current changeset version')
})

test('a keyed review requirement replays current Contribution truth after response-cache loss', async () => {
  const { projectId, cid } = await arena()
  const key = `contribution-require-review-${n}`
  const headers = { 'x-tenant-id': A, 'idempotency-key': key }
  const expectedId = contributionReviewRequirementId(A, projectId, cid, key)

  const first = await call(
    'POST',
    `/projects/${projectId}/contributions/${cid}/require-review`,
    undefined,
    headers,
  )
  assert.equal(first.status, 200)
  assert.equal(first.json.reviewRequired, true)
  const receipt = first.json.events.find((event: any) => event.id === expectedId)
  assert.equal(receipt.kind, 'review-required')
  assert.equal(receipt.reviewRequiredByTenant, undefined, 'the raw tightening authority stays private')

  await call(
    'POST',
    `/projects/${projectId}/contributions/${cid}/land`,
    undefined,
    { 'x-tenant-id': A },
  )
  await call(
    'POST',
    `/projects/${projectId}/contributions/${cid}/comments`,
    { body: 'history after the review requirement' },
    { 'x-tenant-id': C },
  )
  const replay = await callFresh(
    'POST',
    `/projects/${projectId}/contributions/${cid}/require-review`,
    undefined,
    headers,
  )
  assert.equal(replay.status, 200, 'durable truth precedes the landed/already-required gates')
  assert.equal(replay.json.status, 'landed', 'replay returns the current containing Contribution')
  assert.equal(replay.json.events.at(-1).body, 'history after the review requirement')
  assert.equal(replay.json.events.filter((event: any) => event.id === expectedId).length, 1)

  const fresh = await callFresh(
    'POST',
    `/projects/${projectId}/contributions/${cid}/require-review`,
    undefined,
    { 'x-tenant-id': A, 'idempotency-key': `${key}-fresh` },
  )
  assert.equal(fresh.status, 409, 'another logical tightening still observes terminal state')
  const bystander = await callFresh(
    'POST',
    `/projects/${projectId}/contributions/${cid}/require-review`,
    undefined,
    { 'x-tenant-id': C, 'idempotency-key': key },
  )
  assert.equal(bystander.status, 403, 'the same raw key in another tenant scope cannot claim owner authority')
})

test('the per-contribution note cap answers 409; the per-project open cap answers 409', async () => {
  const { projectId, cid } = await arena()
  for (let i = 0; i < 100; i += 1) store.noteContribution(projectId, cid, `c${i}`, B, undefined)
  const over = await call('POST', `/projects/${projectId}/contributions/${cid}/comments`, { body: 'one too many' }, { 'x-tenant-id': C })
  assert.equal(over.status, 409, 'a bound, not a blob store')

  const capId = `p-contrib-cap-${(n += 1)}`
  store.applyRelationOp({ kind: 'create-project', projectId: capId, projectName: 'Cap', projectDescription: '' }, A)
  for (let i = 0; i < 49; i += 1) store.openContribution(capId, { title: `c${i}` }, A, undefined)
  const fiftieth = await call('POST', `/projects/${capId}/contributions`, { title: 'the last one' }, { 'x-tenant-id': A })
  assert.equal(fiftieth.status, 200)
  const overCap = await call('POST', `/projects/${capId}/contributions`, { title: 'one too many' }, { 'x-tenant-id': A })
  assert.equal(overCap.status, 409)
})

test('the TOTAL cap bounds an open→land loop — self-landing cannot grow a ledger forever', async () => {
  // Landing is contributor-or-owner and the contributor IS the opener, so the
  // open cap alone would never fire for a hostile open→land loop; the total
  // cap is the bound that does (review finding, 2026-07-20).
  const totalId = `p-contrib-total-${(n += 1)}`
  store.applyRelationOp({ kind: 'create-project', projectId: totalId, projectName: 'Total', projectDescription: '' }, A)
  store.applyRelationOp({ kind: 'share-project', projectId: totalId, projectName: 'Total', shared: true }, A)
  for (let i = 0; i < 200; i += 1) {
    const c = store.openContribution(totalId, { title: `loop ${i}` }, B, undefined)
    assert.notEqual(c, 'capped', `row ${i} fits under the total cap`)
    // The OWNER lands each (Phase E: an untrusted contributor's self-land is
    // tier-gated) — the total bound must hold regardless of who lands.
    store.landContribution(totalId, (c as { id: string }).id, A, undefined)
  }
  const over = await call('POST', `/projects/${totalId}/contributions`, { title: 'one too many' }, { 'x-tenant-id': B })
  assert.equal(over.status, 409, 'the 201st row is refused even with zero open')
})

test('a keyed Contribution owns one immutable ledger row beyond response-cache lifetime', async () => {
  const projectId = `p-contrib-keyed-${(n += 1)}`
  store.applyRelationOp({ kind: 'create-project', projectId, projectName: 'Durable Contribution', projectDescription: '' }, A)
  const key = `contribution-create-${n}`
  const headers = { 'x-tenant-id': A, 'idempotency-key': key }
  const request = {
    title: 'Declare one durable change',
    summary: 'Keep the exact intent through acknowledgement loss.',
    subGoal: 'Reliable ledger entry',
  }
  const expectedId = contributionCreationId(A, projectId, key)

  const created = await call('POST', `/projects/${projectId}/contributions`, request, headers)
  assert.equal(created.status, 200)
  assert.equal(created.json.id, expectedId)
  const cachedReplay = await call('POST', `/projects/${projectId}/contributions`, {
    title: 'Changed retry must not duplicate work',
    summary: 'Changed summary',
  }, headers)
  assert.equal(cachedReplay.status, 200)
  assert.equal(cachedReplay.headers['idempotency-replayed'], 'true')
  assert.equal(cachedReplay.json.title, request.title)

  // Fill the open ledger after the original commit. A fresh router models
  // process-local response-cache loss: durable identity must answer before a
  // changed body or current admission cap can create or reject different work.
  for (let i = 0; i < 49; i += 1) {
    const filler = store.openContribution(projectId, { title: `filler ${i}` }, A, undefined)
    assert.notEqual(filler, 'capped')
  }
  const durableReplay = await callFresh('POST', `/projects/${projectId}/contributions`, {
    title: null,
    summary: 'Invalid changed retry',
  }, headers)
  assert.equal(durableReplay.status, 200)
  assert.equal(durableReplay.headers['idempotency-replayed'], undefined)
  assert.equal(durableReplay.json.id, expectedId)
  assert.equal(durableReplay.json.title, request.title)
  assert.equal(durableReplay.json.summary, request.summary)
  assert.equal(durableReplay.json.subGoal, request.subGoal)
  const roster = store.listContributions(projectId, A)
  assert.equal(roster.filter((contribution) => contribution.id === expectedId).length, 1,
    'durable identity, not only the response cache, prevents duplicate declared work')
})

test('envelope: propose is open deliberation; APPROVE is owner-only (the floor rule); amendment invalidates approval', async () => {
  const { projectId, cid } = await arena()
  // The contributor proposes; a bystander may counter-propose (deliberation is
  // open — approval is the gate); a bystander/contributor may NOT approve.
  const proposed = await call(
    'POST', `/projects/${projectId}/contributions/${cid}/envelope`,
    { lines: [{ type: 'connector.write', target: 'gmail:partner', cardinality: 2, harness: 'draft-escrow', note: 're: launch' }] },
    { 'x-tenant-id': B },
  )
  assert.equal(proposed.status, 200)
  assert.equal(proposed.json.envelope.version, 1)
  assert.equal(proposed.json.envelope.status, 'proposed')
  assert.equal(proposed.json.envelope.lines[0].used, 0)
  assert.equal(proposed.json.events.at(-1).kind, 'envelope-proposed')

  for (const t of [B, C]) {
    const denied = await call('POST', `/projects/${projectId}/contributions/${cid}/envelope/approve`, undefined, { 'x-tenant-id': t })
    assert.equal(denied.status, 403, `${t} is not the project owner — no approval`)
  }
  const approved = await call('POST', `/projects/${projectId}/contributions/${cid}/envelope/approve`, undefined, { 'x-tenant-id': A })
  assert.equal(approved.status, 200)
  assert.equal(approved.json.envelope.status, 'approved')
  assert.equal(approved.json.envelope.approvedVersion, 1)
  assert.equal(approved.json.envelope.approvedBy, A)
  const again = await call('POST', `/projects/${projectId}/contributions/${cid}/envelope/approve`, undefined, { 'x-tenant-id': A })
  assert.equal(again.status, 409, 'nothing awaiting approval')

  // Amending an APPROVED envelope is an ungated-revocation power a stranger
  // must not hold — contributor or owner only (review finding); while merely
  // PROPOSED, deliberation stays open to any viewer.
  const grief = await call(
    'POST', `/projects/${projectId}/contributions/${cid}/envelope`,
    { lines: [{ type: 'charge', target: 'budget:demo' }] },
    { 'x-tenant-id': C },
  )
  assert.equal(grief.status, 403, 'a bystander cannot revoke a standing approval by amending')

  // An AMENDMENT (by the contributor) is a new version back in `proposed` — the
  // stale approval can never cover it, and the superseded version's record
  // survives in the amendment event's body.
  const amended = await call(
    'POST', `/projects/${projectId}/contributions/${cid}/envelope`,
    { lines: [{ type: 'connector.write', target: 'gmail:partner' }, { type: 'charge', target: 'budget:demo' }] },
    { 'x-tenant-id': B },
  )
  assert.equal(amended.json.envelope.version, 2)
  assert.equal(amended.json.envelope.status, 'proposed')
  assert.match(amended.json.events.at(-1).body, /supersedes v1/, 'the replaced version rides the timeline')
  // Back in `proposed`, a bystander may counter-propose again (open deliberation).
  const counter = await call(
    'POST', `/projects/${projectId}/contributions/${cid}/envelope`,
    { lines: [{ type: 'charge', target: 'budget:demo', cardinality: 1 }] },
    { 'x-tenant-id': C },
  )
  assert.equal(counter.status, 200)
  assert.equal(counter.json.envelope.version, 3)

  // Funnel validation: empty lines / bad type / zero cardinality refuse.
  for (const bad of [
    { lines: [] },
    { lines: [null] },
    { lines: [{ type: 'not-a-type', target: 'x' }] },
    { lines: [{ type: 'charge', target: 'x', cardinality: 0 }] },
    { lines: [{ type: 'charge', target: 'x', harness: 'yolo' }] },
    { lines: [{ type: 'charge', target: 'x', note: 42 }] },
    { lines: [{ type: 'charge', target: 'x' }, { type: 'charge', target: ' x ' }] },
    { lines: [{ type: 'charge', target: 'x' }], expectedVersion: -1 },
  ]) {
    const r = await call('POST', `/projects/${projectId}/contributions/${cid}/envelope`, bad, { 'x-tenant-id': B })
    assert.equal(r.status, 400, JSON.stringify(bad))
  }
})

test('a keyed envelope proposal owns one exact payload and base across cache loss and later amendment', async () => {
  const { projectId, cid } = await arena()
  const key = `contribution-envelope-proposal-${n}`
  const headers = { 'x-tenant-id': B, 'idempotency-key': key }
  const expectedId = contributionEnvelopeProposalId(B, projectId, cid, key)
  const request = {
    expectedVersion: 0,
    lines: [
      { type: 'connector.write', target: ' gmail:version-one ', cardinality: 2, harness: 'draft-escrow', note: ' review drafts ' },
      { type: 'charge', target: 'budget:launch', cardinality: 1, harness: 'dry-run', note: '' },
    ],
  }
  const first = await call(
    'POST',
    `/projects/${projectId}/contributions/${cid}/envelope`,
    request,
    headers,
  )
  assert.equal(first.status, 200)
  assert.equal(first.json.envelope.version, 1)
  assert.equal(first.json.envelope.lines[0].target, 'gmail:version-one')
  assert.equal(first.json.envelope.lines[0].note, 'review drafts')
  const receipt = first.json.events.find((event: any) => event.id === expectedId)
  assert.equal(receipt.kind, 'envelope-proposed')
  assert.equal(receipt.envelopeVersion, 1)
  assert.equal(receipt.proposedByTenant, undefined)
  assert.equal(receipt.envelopeProposalLines, undefined)
  assert.equal(receipt.envelopeProposalExpectedVersion, undefined)

  await call(
    'POST',
    `/projects/${projectId}/contributions/${cid}/envelope`,
    { expectedVersion: 1, lines: [{ type: 'connector.read', target: 'calendar:launch', harness: 'canary' }] },
    { 'x-tenant-id': C },
  )
  await call(
    'POST',
    `/projects/${projectId}/contributions/${cid}/comments`,
    { body: 'History after the proposal response was serialized.' },
    { 'x-tenant-id': A },
  )
  const replay = await callFresh(
    'POST',
    `/projects/${projectId}/contributions/${cid}/envelope`,
    request,
    headers,
  )
  assert.equal(replay.status, 200, 'durable replay precedes current envelope gates')
  assert.equal(replay.headers['idempotency-replayed'], undefined)
  assert.equal(replay.json.envelope.version, 2)
  assert.equal(replay.json.envelope.lines[0].target, 'calendar:launch', 'replay serves current truth')
  assert.equal(replay.json.events.filter((event: any) => event.id === expectedId).length, 1)
  assert.equal(replay.json.events.at(-1).body, 'History after the proposal response was serialized.')

  const changedPayload = await callFresh(
    'POST',
    `/projects/${projectId}/contributions/${cid}/envelope`,
    { ...request, lines: [{ type: 'charge', target: 'budget:changed' }] },
    headers,
  )
  assert.equal(changedPayload.status, 400, 'one logical key cannot be redirected to another envelope')
  const changedBase = await callFresh(
    'POST',
    `/projects/${projectId}/contributions/${cid}/envelope`,
    { ...request, expectedVersion: 2 },
    headers,
  )
  assert.equal(changedBase.status, 400, 'one logical key cannot be redirected to another base')
  const stale = await callFresh(
    'POST',
    `/projects/${projectId}/contributions/${cid}/envelope`,
    request,
    { 'x-tenant-id': B, 'idempotency-key': `${key}-stale` },
  )
  assert.equal(stale.status, 409, 'a fresh proposal cannot overwrite a newer envelope version')
})

test('a keyed envelope approval owns one exact reviewed version across cache loss and later amendment', async () => {
  const { projectId, cid } = await arena()
  await call(
    'POST',
    `/projects/${projectId}/contributions/${cid}/envelope`,
    { lines: [{ type: 'connector.write', target: 'gmail:version-one', cardinality: 1 }] },
    { 'x-tenant-id': B },
  )
  const key = `contribution-envelope-approval-${n}`
  const headers = { 'x-tenant-id': A, 'idempotency-key': key }
  const expectedId = contributionEnvelopeApprovalId(A, projectId, cid, key)
  const first = await call(
    'POST',
    `/projects/${projectId}/contributions/${cid}/envelope/approve`,
    { expectedVersion: 1 },
    headers,
  )
  assert.equal(first.status, 200)
  assert.equal(first.json.envelope.approvedVersion, 1)
  const receipt = first.json.events.find((event: any) => event.id === expectedId)
  assert.equal(receipt.kind, 'envelope-approved')
  assert.equal(receipt.envelopeVersion, 1)
  assert.equal(receipt.approvedByTenant, undefined, 'raw retry authority never crosses the wire')

  await call(
    'POST',
    `/projects/${projectId}/contributions/${cid}/envelope`,
    { lines: [{ type: 'charge', target: 'budget:version-two', cardinality: 2 }] },
    { 'x-tenant-id': B },
  )
  await call(
    'POST',
    `/projects/${projectId}/contributions/${cid}/comments`,
    { body: 'History after the approval response was serialized.' },
    { 'x-tenant-id': A },
  )
  const replay = await callFresh(
    'POST',
    `/projects/${projectId}/contributions/${cid}/envelope/approve`,
    { expectedVersion: 1 },
    headers,
  )
  assert.equal(replay.status, 200, 'durable replay precedes current envelope gates')
  assert.equal(replay.headers['idempotency-replayed'], undefined)
  assert.equal(replay.json.envelope.version, 2)
  assert.equal(replay.json.envelope.status, 'proposed', 'replay cannot authorize a later amendment')
  assert.equal(replay.json.events.filter((event: any) => event.id === expectedId).length, 1)
  assert.equal(replay.json.events.at(-1).body, 'History after the approval response was serialized.')

  const redirected = await callFresh(
    'POST',
    `/projects/${projectId}/contributions/${cid}/envelope/approve`,
    { expectedVersion: 2 },
    headers,
  )
  assert.equal(redirected.status, 400, 'one logical key cannot be redirected to a later version')

  const stale = await callFresh(
    'POST',
    `/projects/${projectId}/contributions/${cid}/envelope/approve`,
    { expectedVersion: 1 },
    { 'x-tenant-id': A, 'idempotency-key': `${key}-stale` },
  )
  assert.equal(stale.status, 409, 'fresh consent must match the envelope version currently awaiting approval')
})

test('envelope: acts match MECHANICALLY — consume cardinality, refuse outside/exhausted/unapproved, refusals recorded', async () => {
  const { projectId, cid } = await arena()
  // No envelope at all → refused, and the refusal is timeline material.
  const bare = await call('POST', `/projects/${projectId}/contributions/${cid}/effects`, { lineId: 'cev-x' }, { 'x-tenant-id': B })
  assert.equal(bare.status, 409)

  await call('POST', `/projects/${projectId}/contributions/${cid}/envelope`,
    { lines: [{ type: 'connector.write', target: 'gmail:partner', cardinality: 2 }] }, { 'x-tenant-id': B })
  const unapproved = await call('POST', `/projects/${projectId}/contributions/${cid}/effects`, { lineId: 'cev-x' }, { 'x-tenant-id': B })
  assert.equal(unapproved.status, 409, 'a proposed-but-unapproved envelope covers nothing')

  const approved = await call('POST', `/projects/${projectId}/contributions/${cid}/envelope/approve`, undefined, { 'x-tenant-id': A })
  const lineId = approved.json.envelope.lines[0].id as string

  // A bystander may not fire acts even inside the envelope.
  const stranger = await call('POST', `/projects/${projectId}/contributions/${cid}/effects`, { lineId }, { 'x-tenant-id': C })
  assert.equal(stranger.status, 403)

  const one = await call('POST', `/projects/${projectId}/contributions/${cid}/effects`, { lineId }, { 'x-tenant-id': B })
  assert.equal(one.status, 200)
  assert.equal(one.json.envelope.lines[0].used, 1)
  assert.equal(one.json.events.at(-1).kind, 'effect-executed')
  const two = await call('POST', `/projects/${projectId}/contributions/${cid}/effects`, { lineId }, { 'x-tenant-id': B })
  assert.equal(two.json.envelope.lines[0].used, 2)

  // Cardinality exhausted → mechanical refusal, recorded — the envelope is a
  // bound, not a mood; unknown line = outside the envelope, same treatment.
  const over = await call('POST', `/projects/${projectId}/contributions/${cid}/effects`, { lineId }, { 'x-tenant-id': B })
  assert.equal(over.status, 409)
  const outside = await call('POST', `/projects/${projectId}/contributions/${cid}/effects`, { lineId: 'cev-nope' }, { 'x-tenant-id': B })
  assert.equal(outside.status, 409)
  const list = (await call('GET', `/projects/${projectId}/contributions`, undefined, { 'x-tenant-id': A })).json
  const events = list.find((x: any) => x.id === cid).events
  assert.equal(events.filter((e: any) => e.kind === 'effect-refused').length, 4, 'every refusal is on the record')
  assert.equal(events.filter((e: any) => e.kind === 'effect-executed').length, 2)

  // Landing closes the plan: remaining cardinality does NOT survive (the
  // server agrees with the UI — review finding). Amend an unspent line in,
  // approve, land, then try to fire it.
  const other = await arena()
  await call('POST', `/projects/${other.projectId}/contributions/${other.cid}/envelope`,
    { lines: [{ type: 'charge', target: 'budget:demo', cardinality: 2 }] }, { 'x-tenant-id': B })
  const app2 = await call('POST', `/projects/${other.projectId}/contributions/${other.cid}/envelope/approve`, undefined, { 'x-tenant-id': A })
  // An effectful contribution is Tier 2 — the OWNER lands it (the floor).
  await call('POST', `/projects/${other.projectId}/contributions/${other.cid}/land`, undefined, { 'x-tenant-id': A })
  const late = await call('POST', `/projects/${other.projectId}/contributions/${other.cid}/effects`,
    { lineId: app2.json.envelope.lines[0].id }, { 'x-tenant-id': B })
  assert.equal(late.status, 409, 'a landed contribution’s plan is immutable — no act fires after landing')
})

test('a keyed envelope act owns one durable exact receipt across cache loss, later history, and changed Retry input', async () => {
  const { projectId, cid } = await arena()
  await call('POST', `/projects/${projectId}/contributions/${cid}/envelope`,
    { lines: [{ type: 'connector.write', target: 'gmail:durable', cardinality: 2 }] }, { 'x-tenant-id': B })
  const approved = await call(
    'POST',
    `/projects/${projectId}/contributions/${cid}/envelope/approve`,
    undefined,
    { 'x-tenant-id': A },
  )
  const lineId = approved.json.envelope.lines[0].id as string
  const key = `contribution-effect-${n}`
  const headers = { 'x-tenant-id': B, 'idempotency-key': key }
  const expectedId = contributionEffectExecutionId(B, projectId, cid, key)

  const first = await call(
    'POST',
    `/projects/${projectId}/contributions/${cid}/effects`,
    { lineId },
    headers,
  )
  assert.equal(first.status, 200)
  assert.equal(first.json.envelope.lines[0].used, 1)
  const receipt = first.json.events.find((event: any) => event.id === expectedId)
  assert.equal(receipt.kind, 'effect-executed')
  assert.equal(receipt.lineId, lineId, 'the public receipt names the exact approved line')
  assert.equal(receipt.effectByTenant, undefined, 'raw retry authority never crosses the wire')
  assert.equal(receipt.effectResult, undefined, 'the private replay outcome never crosses the wire')

  await call(
    'POST',
    `/projects/${projectId}/contributions/${cid}/comments`,
    { body: 'History added after the effect acknowledgement was serialized.' },
    { 'x-tenant-id': A },
  )
  const replay = await callFresh(
    'POST',
    `/projects/${projectId}/contributions/${cid}/effects`,
    { lineId },
    headers,
  )
  assert.equal(replay.status, 200)
  assert.equal(replay.headers['idempotency-replayed'], undefined)
  assert.equal(replay.json.envelope.lines[0].used, 1, 'durable replay cannot consume cardinality twice')
  assert.equal(replay.json.events.filter((event: any) => event.id === expectedId).length, 1)
  assert.equal(replay.json.events.at(-1).body, 'History added after the effect acknowledgement was serialized.',
    'durable replay returns current ledger history')

  const changedLine = await callFresh(
    'POST',
    `/projects/${projectId}/contributions/${cid}/effects`,
    { lineId: 'eline-changed-retry' },
    headers,
  )
  assert.equal(changedLine.status, 400, 'one logical key cannot be redirected to another envelope line')
})

test('a keyed mechanical refusal is one durable attempt and cannot become an execution after approval', async () => {
  const { projectId, cid } = await arena()
  const proposed = await call('POST', `/projects/${projectId}/contributions/${cid}/envelope`,
    { lines: [{ type: 'charge', target: 'budget:durable-refusal', cardinality: 1 }] }, { 'x-tenant-id': B })
  const lineId = proposed.json.envelope.lines[0].id as string
  const key = `contribution-effect-refusal-${n}`
  const headers = { 'x-tenant-id': B, 'idempotency-key': key }
  const expectedId = contributionEffectExecutionId(B, projectId, cid, key)

  const refused = await call(
    'POST',
    `/projects/${projectId}/contributions/${cid}/effects`,
    { lineId },
    headers,
  )
  assert.equal(refused.status, 409)
  await call('POST', `/projects/${projectId}/contributions/${cid}/envelope/approve`, undefined, { 'x-tenant-id': A })
  const replay = await callFresh(
    'POST',
    `/projects/${projectId}/contributions/${cid}/effects`,
    { lineId },
    headers,
  )
  assert.equal(replay.status, 409, 'the same refused attempt cannot turn into a later execution')

  const ledger = await call('GET', `/projects/${projectId}/contributions`, undefined, { 'x-tenant-id': B })
  const contribution = ledger.json.find((candidate: any) => candidate.id === cid)
  assert.equal(contribution.envelope.lines[0].used, 0)
  assert.equal(contribution.events.filter((event: any) => event.id === expectedId).length, 1,
    'Retry records neither another refusal nor an execution')
  assert.equal(contribution.events.find((event: any) => event.id === expectedId).kind, 'effect-refused')

  const freshAttempt = await callFresh(
    'POST',
    `/projects/${projectId}/contributions/${cid}/effects`,
    { lineId },
    { ...headers, 'idempotency-key': `${key}-new-attempt` },
  )
  assert.equal(freshAttempt.status, 200, 'a deliberate new act receives a new receipt and may run')
  assert.equal(freshAttempt.json.envelope.lines[0].used, 1)
})

test('the timeline-event cap bounds the envelope kinds too — no unbounded growth via propose/refuse loops', async () => {
  const { projectId, cid } = await arena()
  // Drive the timeline to its bound through the real mutator (each proposal is
  // one event); then both a further proposal AND a refusal-recording act refuse.
  for (let i = 0; ; i += 1) {
    const out = store.proposeEnvelope(projectId, cid, { lines: [{ type: 'charge', target: `t${i}` }] }, B, undefined)
    if (out === 'capped') break
    assert.ok(i < 400, 'the cap must fire well before 400 proposals')
  }
  const over = await call('POST', `/projects/${projectId}/contributions/${cid}/envelope`,
    { lines: [{ type: 'charge', target: 'x' }] }, { 'x-tenant-id': C })
  assert.equal(over.status, 409, 'a full timeline refuses further proposals')
  const refusal = await call('POST', `/projects/${projectId}/contributions/${cid}/effects`, { lineId: 'cev-nope' }, { 'x-tenant-id': B })
  assert.equal(refusal.status, 409, 'the act is refused')
  const events = (await call('GET', `/projects/${projectId}/contributions`, undefined, { 'x-tenant-id': A })).json
    .find((x: any) => x.id === cid).events
  assert.ok(events.length <= 301, 'the refusal did not grow a full timeline')
})

test('changeset: append-only versions with review deltas; author-only; landed = immutable (CW3/CW4)', async () => {
  const { projectId, cid } = await arena()
  // A bystander (who may comment and counter-propose envelopes) may NOT author
  // the changeset — crystallizing is the work's own act.
  const stranger = await call('POST', `/projects/${projectId}/contributions/${cid}/changeset`,
    { entries: [{ kind: 'note', target: 'plan', after: 'x' }] }, { 'x-tenant-id': C })
  assert.equal(stranger.status, 403)

  const v1 = await call('POST', `/projects/${projectId}/contributions/${cid}/changeset`,
    { entries: [
      { kind: 'description', target: 'description', before: 'old intro', after: 'new intro' },
      { kind: 'file', target: 'src/app.ts', after: 'created content' },
    ] }, { 'x-tenant-id': B })
  assert.equal(v1.status, 200)
  assert.equal(v1.json.changeset.length, 1)
  assert.equal(v1.json.changeset[0].version, 1)
  assert.equal(v1.json.changeset[0].by, B)
  assert.equal(v1.json.changeset[0].entries[0].before, 'old intro')
  assert.equal(v1.json.changeset[0].entries[1].before, undefined, 'a create has no before (INV-9)')
  assert.equal(v1.json.events.at(-1).kind, 'crystallized')
  assert.equal(v1.json.events.at(-1).changesetVersion, 1, 'the timeline event structurally names its version')
  assert.match(v1.json.events.at(-1).body, /^v1 · 2 changes$/, 'v1 has no delta — nothing prior')

  // v2 APPENDS beside v1 (no force-push) and its event carries the review
  // delta vs v1 keyed by (kind, target): one changed, one removed, one added.
  const v2 = await call('POST', `/projects/${projectId}/contributions/${cid}/changeset`,
    { entries: [
      { kind: 'description', target: 'description', before: 'old intro', after: 'REVISED intro' },
      { kind: 'note', target: 'follow-up', after: 'added note' },
    ] }, { 'x-tenant-id': B })
  assert.equal(v2.json.changeset.length, 2, 'append-only — v1 survives beside v2')
  assert.equal(v2.json.changeset[0].entries[0].after, 'new intro', 'v1 is untouched')
  assert.equal(v2.json.changeset[1].version, 2)
  assert.match(v2.json.events.at(-1).body, /vs v1: \+1 −1 ~1/, 'the review delta is first-class')

  // Funnel validation: bad kind, empty set, duplicate (kind,target) — the
  // delta is keyed on that pair, so duplicates would miscount — and the
  // per-version entry cap; the OWNER may also crystallize (contributor-or-owner).
  for (const bad of [
    { entries: [{ kind: 'nope', target: 'x', after: 'y' }] },
    { entries: [] },
    { entries: [{ kind: 'note', target: 'dup', after: 'a' }, { kind: 'note', target: 'dup', after: 'b' }] },
    { entries: [
      { kind: 'note', target: `${'x'.repeat(2000)}a`, after: 'a' },
      { kind: 'note', target: `${'x'.repeat(2000)}b`, after: 'b' },
    ] },
    { entries: Array.from({ length: 21 }, (_, i) => ({ kind: 'note', target: `t${i}`, after: 'x' })) },
  ]) {
    const r = await call('POST', `/projects/${projectId}/contributions/${cid}/changeset`, bad, { 'x-tenant-id': B })
    assert.equal(r.status, 400, JSON.stringify(bad).slice(0, 60))
  }
  const long = await call('POST', `/projects/${projectId}/contributions/${cid}/changeset`,
    { entries: [{ kind: 'note', target: 'long', after: 'x'.repeat(5000) }] }, { 'x-tenant-id': A })
  assert.equal(long.status, 200, 'the OWNER may crystallize too')
  assert.equal(long.json.changeset.at(-1).entries[0].after.length, 2000, 'text capped at the funnel')

  // The version cap answers 409, not silent growth (append-only accumulates).
  for (let i = 0; ; i += 1) {
    const out = store.crystallizeContribution(projectId, cid, { entries: [{ kind: 'note', target: 'n', after: `v${i}` }] }, B, undefined)
    if (out === 'capped') break
    assert.ok(i < 30, 'the version cap must fire before 30')
  }
  const overV = await call('POST', `/projects/${projectId}/contributions/${cid}/changeset`,
    { entries: [{ kind: 'note', target: 'n', after: 'over' }] }, { 'x-tenant-id': B })
  assert.equal(overV.status, 409)

  await call('POST', `/projects/${projectId}/contributions/${cid}/land`, undefined, { 'x-tenant-id': A })
  const late = await call('POST', `/projects/${projectId}/contributions/${cid}/changeset`,
    { entries: [{ kind: 'note', target: 'late', after: 'z' }] }, { 'x-tenant-id': B })
  assert.equal(late.status, 409, 'a landed contribution’s changeset is immutable history')
})

test('a keyed crystallization owns one exact durable version across response-cache loss and later history', async () => {
  const { projectId, cid } = await arena()
  const key = `contribution-crystallization-${n}`
  const headers = { 'x-tenant-id': B, 'idempotency-key': key }
  const request = { entries: [
    { kind: 'description' as const, target: 'About', before: 'Old', after: 'New' },
    { kind: 'file' as const, target: 'src/reliable.ts', after: 'export const reliable = true' },
  ] }
  const expectedId = contributionCrystallizationId(B, projectId, cid, key)

  const first = await call(
    'POST',
    `/projects/${projectId}/contributions/${cid}/changeset`,
    request,
    headers,
  )
  assert.equal(first.status, 200)
  assert.equal(first.json.changeset.length, 1)
  const receipt = first.json.events.find((event: any) => event.id === expectedId)
  assert.equal(receipt.kind, 'crystallized')
  assert.equal(receipt.changesetVersion, 1)
  assert.equal(receipt.crystallizedByTenant, undefined, 'raw retry authority never crosses the wire')

  await call('POST', `/projects/${projectId}/contributions/${cid}/land`, undefined, { 'x-tenant-id': A })
  await call(
    'POST',
    `/projects/${projectId}/contributions/${cid}/comments`,
    { body: 'Aftermath added after the crystallization acknowledgement was serialized.' },
    { 'x-tenant-id': A },
  )
  const replay = await callFresh(
    'POST',
    `/projects/${projectId}/contributions/${cid}/changeset`,
    request,
    headers,
  )
  assert.equal(replay.status, 200, 'durable replay precedes the later landed-state refusal')
  assert.equal(replay.headers['idempotency-replayed'], undefined)
  assert.equal(replay.json.status, 'landed')
  assert.equal(replay.json.changeset.length, 1, 'the append-only version is not duplicated')
  assert.equal(replay.json.events.filter((event: any) => event.id === expectedId).length, 1)
  assert.equal(replay.json.events.at(-1).body, 'Aftermath added after the crystallization acknowledgement was serialized.',
    'durable replay returns current containing history')

  const changed = await callFresh(
    'POST',
    `/projects/${projectId}/contributions/${cid}/changeset`,
    { entries: [{ kind: 'note', target: 'different', after: 'Different retry body' }] },
    headers,
  )
  assert.equal(changed.status, 400, 'one logical key cannot be redirected to another changeset payload')
})

test('tiers (CW5): the arithmetic is legible; the floor is un-buyable; tighten-only; stale review never covers', async () => {
  const projectId = `p-tier-${(n += 1)}`
  store.applyRelationOp({ kind: 'create-project', projectId, projectName: 'Tiers', projectDescription: '' }, A)
  store.applyRelationOp({ kind: 'share-project', projectId, projectName: 'Tiers', shared: true }, A)
  const openOne = async (title: string) =>
    (await call('POST', `/projects/${projectId}/contributions`, { title }, { 'x-tenant-id': B })).json

  // Fresh contributor, no effects → Tier 1, basis names the arithmetic.
  const c1 = await openOne('first')
  assert.equal(c1.tier.level, 1)
  assert.match(c1.tier.basis, /0 of 3 landings/)

  // Earn trust: three reviewed landings → the fourth reads Tier 0.
  for (const cx of [c1, await openOne('second'), await openOne('third')]) {
    await call('POST', `/projects/${projectId}/contributions/${cx.id}/changeset`,
      { entries: [{ kind: 'note', target: 'work', after: 'done' }] }, { 'x-tenant-id': B })
    await call('POST', `/projects/${projectId}/contributions/${cx.id}/review`, undefined, { 'x-tenant-id': B })
    const landed = await call('POST', `/projects/${projectId}/contributions/${cx.id}/land`, undefined, { 'x-tenant-id': B })
    assert.equal(landed.status, 200, 'the reviewed Tier-1 path lands')
  }
  const trusted = await openOne('fourth — trusted now')
  assert.equal(trusted.tier.level, 0)
  assert.match(trusted.tier.basis, /trusted: 3 landed here/)

  // THE FLOOR: give the trusted contributor an irreversible envelope line —
  // Tier 2, and the self-land refuses no matter the record. Only the owner lands.
  await call('POST', `/projects/${projectId}/contributions/${trusted.id}/envelope`,
    { lines: [{ type: 'connector.write', target: 'gmail:x' }] }, { 'x-tenant-id': B })
  const floored = (await call('GET', `/projects/${projectId}/contributions`, undefined, { 'x-tenant-id': B })).json
    .find((x: any) => x.id === trusted.id)
  assert.equal(floored.tier.level, 2, 'trust never buys past the floor')
  const denied = await call('POST', `/projects/${projectId}/contributions/${trusted.id}/land`, undefined, { 'x-tenant-id': B })
  assert.equal(denied.status, 403)
  const ownerLands = await call('POST', `/projects/${projectId}/contributions/${trusted.id}/land`, undefined, { 'x-tenant-id': A })
  assert.equal(ownerLands.status, 200, 'the owner is the human floor')

  // TIGHTEN-ONLY: the owner forces review on a Tier-0 contribution; a
  // bystander may not; and there is NO loosen op (unrepresentable — nothing to
  // call). A monotonic-only envelope stays sub-floor (risk is the kind, not
  // the envelope's existence).
  const c5 = await openOne('fifth')
  assert.equal(c5.tier.level, 0)
  await call('POST', `/projects/${projectId}/contributions/${c5.id}/envelope`,
    { lines: [{ type: 'connector.read', target: 'linear:board' }] }, { 'x-tenant-id': B })
  const readOnly = (await call('GET', `/projects/${projectId}/contributions`, undefined, { 'x-tenant-id': B })).json
    .find((x: any) => x.id === c5.id)
  assert.equal(readOnly.tier.level, 0, 'a monotonic (read) line is not the hard quadrant')
  const strangerTighten = await call('POST', `/projects/${projectId}/contributions/${c5.id}/require-review`, undefined, { 'x-tenant-id': C })
  assert.equal(strangerTighten.status, 403)
  const tightened = await call('POST', `/projects/${projectId}/contributions/${c5.id}/require-review`, undefined, { 'x-tenant-id': A })
  assert.equal(tightened.json.tier.level, 1)
  assert.match(tightened.json.tier.basis, /owner requires review/)
  assert.equal(tightened.json.events.at(-1).kind, 'review-required')

  // STALE REVIEW NEVER COVERS: review v1, re-crystallize (v2) — the verdict is
  // invalidated; the self-land refuses until v2 is reviewed.
  await call('POST', `/projects/${projectId}/contributions/${c5.id}/changeset`,
    { entries: [{ kind: 'note', target: 'w', after: 'v1' }] }, { 'x-tenant-id': B })
  await call('POST', `/projects/${projectId}/contributions/${c5.id}/review`, undefined, { 'x-tenant-id': B })
  await call('POST', `/projects/${projectId}/contributions/${c5.id}/changeset`,
    { entries: [{ kind: 'note', target: 'w', after: 'v2' }] }, { 'x-tenant-id': B })
  const stale = await call('POST', `/projects/${projectId}/contributions/${c5.id}/land`, undefined, { 'x-tenant-id': B })
  assert.equal(stale.status, 409, 'a re-crystallize invalidates the verdict')
  await call('POST', `/projects/${projectId}/contributions/${c5.id}/review`, undefined, { 'x-tenant-id': B })
  const fresh = await call('POST', `/projects/${projectId}/contributions/${c5.id}/land`, undefined, { 'x-tenant-id': B })
  assert.equal(fresh.status, 200)

  // Reviewing nothing refuses (un-crystallized work has nothing to pass).
  const c6 = await openOne('sixth')
  const nothing = await call('POST', `/projects/${projectId}/contributions/${c6.id}/review`, undefined, { 'x-tenant-id': B })
  assert.equal(nothing.status, 409)

  // THE DODGE IS CLOSED: run an irreversible act, then amend the line away —
  // the floor covers EXECUTED history, not just declared intent, so the tier
  // stays 2 and the trusted contributor still cannot self-land.
  const dodge = await openOne('dodge attempt')
  await call('POST', `/projects/${projectId}/contributions/${dodge.id}/envelope`,
    { lines: [{ type: 'connector.write', target: 'gmail:x' }] }, { 'x-tenant-id': B })
  const dApproved = await call('POST', `/projects/${projectId}/contributions/${dodge.id}/envelope/approve`, undefined, { 'x-tenant-id': A })
  await call('POST', `/projects/${projectId}/contributions/${dodge.id}/effects`,
    { lineId: dApproved.json.envelope.lines[0].id }, { 'x-tenant-id': B })
  const stripped = await call('POST', `/projects/${projectId}/contributions/${dodge.id}/envelope`,
    { lines: [{ type: 'connector.read', target: 'linear:board' }] }, { 'x-tenant-id': B })
  assert.equal(stripped.status, 200, 'the contributor may amend their approved envelope')
  assert.equal(stripped.json.effectsFired, true, 'the executed-history stamp survives the amendment')
  assert.equal(stripped.json.tier.level, 2, 'amending the line away does not drop the floor')
  const dodgeLand = await call('POST', `/projects/${projectId}/contributions/${dodge.id}/land`, undefined, { 'x-tenant-id': B })
  assert.equal(dodgeLand.status, 403, 'executed irreversible history still lands only by the owner')
})

test('delegations (CW8): the mint funnel, the conservation law, SoD, mechanical escalation, draft vs decide', async () => {
  const projectId = `p-deleg-${(n += 1)}`
  store.applyRelationOp({ kind: 'create-project', projectId, projectName: 'Deleg', projectDescription: '' }, A)
  store.applyRelationOp({ kind: 'share-project', projectId, projectName: 'Deleg', shared: true }, A)
  // The delegate must be the DELEGATOR's own agent — mint one for A.
  const agent = store.createAgent({ label: 'A’s approver', providerId: 'provider-claude', tools: [] } as any, A)
  const agentId = (agent as any).id ?? (agent as any).agent?.id

  // The mint funnel's structural refusals: non-owner 403; blank policy 400;
  // a foreign agent 400; unknown trigger 400. `effectful` is ADDED when
  // omitted — stating it optional, escaping it impossible.
  const stranger = await call('POST', `/projects/${projectId}/delegations`,
    { agentId, actKind: 'approve-envelope', policy: 'x' }, { 'x-tenant-id': B })
  assert.equal(stranger.status, 403)
  for (const bad of [
    { agentId, actKind: 'approve-envelope', policy: '   ' },
    { agentId: 'agent-of-someone-else', actKind: 'approve-envelope', policy: 'ok' },
    { agentId, actKind: 'approve-envelope', policy: 'ok', escalation: ['yolo'] },
  ]) {
    const r = await call('POST', `/projects/${projectId}/delegations`, bad, { 'x-tenant-id': A })
    assert.equal(r.status, 400, JSON.stringify(bad).slice(0, 60))
  }
  const minted = await call('POST', `/projects/${projectId}/delegations`,
    { agentId, actKind: 'approve-envelope', policy: 'Approve routine monotonic plans.', mode: 'decide' }, { 'x-tenant-id': A })
  assert.equal(minted.status, 200)
  const did = minted.json.id as string
  assert.deepEqual(minted.json.escalation, ['effectful'], 'the floor trigger is added — not delegable away')
  assert.equal(minted.json.policy, 'Approve routine monotonic plans.', 'the delegator reads their policy')

  // Redaction: a viewer reads the governance face, never the policy text.
  const roster = await call('GET', `/projects/${projectId}/delegations`, undefined, { 'x-tenant-id': B })
  assert.equal(roster.json[0].policy, undefined, 'the judgment text is the delegator’s own instrument')
  assert.equal(roster.json[0].delegatorTenant, undefined, 'no raw tenant id crosses')
  assert.equal(roster.json[0].agentLabel, 'A’s approver')

  // A contribution with a MONOTONIC proposed envelope: B contributes.
  const opened = await call('POST', `/projects/${projectId}/contributions`, { title: 'delegated flow' }, { 'x-tenant-id': B })
  const cid = opened.json.id as string
  await call('POST', `/projects/${projectId}/contributions/${cid}/envelope`,
    { lines: [{ type: 'connector.read', target: 'linear:board' }] }, { 'x-tenant-id': B })

  // SEPARATION OF DUTIES: the contributor may not trigger the decision on
  // their own work; a bystander may.
  const selfRun = await call('POST', `/projects/${projectId}/contributions/${cid}/delegated/${did}`, undefined, { 'x-tenant-id': B })
  assert.equal(selfRun.status, 403)
  const run = await call('POST', `/projects/${projectId}/contributions/${cid}/delegated/${did}`, undefined, { 'x-tenant-id': C })
  assert.equal(run.status, 200)
  // THE CONSERVATION LAW: the decision executed AS the delegator, and the act's
  // own event is dual-stamped — delegate + human + delegation id.
  assert.equal(run.json.envelope.status, 'approved')
  assert.equal(run.json.envelope.approvedBy, A, 'the approval is the DELEGATOR’s act (labor moved, liability did not)')
  const approvedEvent = run.json.events.find((e: any) => e.kind === 'envelope-approved')
  assert.match(approvedEvent.actor, /A’s approver for tenant-contrib-A · delegation-/, 'dual-stamped')
  assert.equal(run.json.events.at(-1).kind, 'delegated-decision')

  // MECHANICAL ESCALATION: an EFFECTFUL envelope always comes back to the
  // human — the delegate refuses to decide and records why.
  const c2 = (await call('POST', `/projects/${projectId}/contributions`, { title: 'effectful' }, { 'x-tenant-id': B })).json
  await call('POST', `/projects/${projectId}/contributions/${c2.id}/envelope`,
    { lines: [{ type: 'charge', target: 'budget:x' }] }, { 'x-tenant-id': B })
  const escalated = await call('POST', `/projects/${projectId}/contributions/${c2.id}/delegated/${did}`, undefined, { 'x-tenant-id': C })
  assert.equal(escalated.status, 200)
  assert.equal(escalated.json.envelope.status, 'proposed', 'NOT approved — escalated instead')
  assert.equal(escalated.json.events.at(-1).kind, 'delegated-escalation')
  assert.match(escalated.json.events.at(-1).body, /effectful/)

  // DRAFT MODE (L1): records the guess, executes nothing.
  const drafter = await call('POST', `/projects/${projectId}/delegations`,
    { agentId, actKind: 'land', policy: 'Land reviewed routine work.', mode: 'draft', escalation: ['unreviewed'] }, { 'x-tenant-id': A })
  const c3 = (await call('POST', `/projects/${projectId}/contributions`, { title: 'draft mode' }, { 'x-tenant-id': B })).json
  await call('POST', `/projects/${projectId}/contributions/${c3.id}/changeset`,
    { entries: [{ kind: 'note', target: 'w', after: 'x' }] }, { 'x-tenant-id': B })
  await call('POST', `/projects/${projectId}/contributions/${c3.id}/review`, undefined, { 'x-tenant-id': C })
  const drafted = await call('POST', `/projects/${projectId}/contributions/${c3.id}/delegated/${drafter.json.id}`, undefined, { 'x-tenant-id': C })
  assert.equal(drafted.json.status, 'open', 'a draft never lands')
  assert.equal(drafted.json.events.at(-1).kind, 'delegated-draft')

  // Revoke: delegator-or-owner, never a bystander; then the roster row is gone.
  const badRevoke = await call('DELETE', `/projects/${projectId}/delegations/${did}`, undefined, { 'x-tenant-id': B })
  assert.equal(badRevoke.status, 403)
  const revoked = await call('DELETE', `/projects/${projectId}/delegations/${did}`, undefined, { 'x-tenant-id': A })
  assert.equal(revoked.status, 200)
  const after = await call('GET', `/projects/${projectId}/delegations`, undefined, { 'x-tenant-id': A })
  assert.equal(after.json.find((d: any) => d.id === did), undefined)

  // A delegation must not outlive its delegate: deleting the agent sweeps its
  // roster rows (cascade-revoke, the proposals-hygiene pattern).
  assert.ok((await call('GET', `/projects/${projectId}/delegations`, undefined, { 'x-tenant-id': A })).json.length > 0, 'the land delegation still stands')
  store.deleteAgent(agentId)
  const swept = await call('GET', `/projects/${projectId}/delegations`, undefined, { 'x-tenant-id': A })
  assert.equal(swept.json.length, 0, 'the dead delegate’s rows are gone')
})

test('a keyed delegated judgment owns one exact durable outcome beyond mutable applicability', async () => {
  const projectId = `p-deleg-judgment-${(n += 1)}`
  store.applyRelationOp({ kind: 'create-project', projectId, projectName: 'Durable Judgment', projectDescription: '' }, A)
  store.applyRelationOp({ kind: 'share-project', projectId, projectName: 'Durable Judgment', shared: true }, A)
  const agent = store.createAgent({ label: 'Durable judge', providerId: 'provider-claude', tools: [] } as any, A)
  const decisionDelegation = await call('POST', `/projects/${projectId}/delegations`, {
    agentId: agent.id,
    actKind: 'approve-envelope',
    policy: 'Approve monotonic work.',
    mode: 'decide',
  }, { 'x-tenant-id': A })
  const contribution = await call('POST', `/projects/${projectId}/contributions`, {
    title: 'Durable delegated approval',
  }, { 'x-tenant-id': B })
  await call('POST', `/projects/${projectId}/contributions/${contribution.json.id}/envelope`, {
    lines: [{ type: 'connector.read', target: 'linear:durable' }],
  }, { 'x-tenant-id': B })

  const key = `delegated-judgment-${n}`
  const headers = { 'x-tenant-id': C, 'idempotency-key': key }
  const expectedId = delegatedJudgmentId(C, projectId, contribution.json.id, decisionDelegation.json.id, key)
  const decided = await call(
    'POST',
    `/projects/${projectId}/contributions/${contribution.json.id}/delegated/${decisionDelegation.json.id}`,
    undefined,
    headers,
  )
  assert.equal(decided.status, 200)
  assert.equal(decided.json.envelope.status, 'approved')
  const receipt = decided.json.events.find((event: any) => event.id === expectedId)
  assert.equal(receipt.kind, 'delegated-decision')
  assert.equal(receipt.delegationId, decisionDelegation.json.id)
  assert.equal(receipt.delegatedByTenant, undefined, 'raw retry authority never crosses the wire')

  await call('DELETE', `/projects/${projectId}/delegations/${decisionDelegation.json.id}`, undefined, {
    'x-tenant-id': A,
  })
  await call('POST', `/projects/${projectId}/contributions/${contribution.json.id}/comments`, {
    body: 'Later history remains visible on replay.',
  }, { 'x-tenant-id': A })
  const replay = await callFresh(
    'POST',
    `/projects/${projectId}/contributions/${contribution.json.id}/delegated/${decisionDelegation.json.id}`,
    undefined,
    headers,
  )
  assert.equal(replay.status, 200, 'the receipt answers after revocation and approval made the act inapplicable')
  assert.equal(replay.headers['idempotency-replayed'], undefined)
  assert.equal(replay.json.events.filter((event: any) => event.id === expectedId).length, 1)
  assert.equal(replay.json.events.filter((event: any) => event.kind === 'envelope-approved').length, 1)
  assert.ok(replay.json.events.some((event: any) => event.body === 'Later history remains visible on replay.'))

  const draftDelegation = await call('POST', `/projects/${projectId}/delegations`, {
    agentId: agent.id,
    actKind: 'land',
    policy: 'Draft a landing judgment.',
    mode: 'draft',
  }, { 'x-tenant-id': A })
  const draftedContribution = await call('POST', `/projects/${projectId}/contributions`, {
    title: 'Durable delegated draft',
  }, { 'x-tenant-id': B })
  const draftKey = `delegated-draft-${n}`
  const draftHeaders = { 'x-tenant-id': C, 'idempotency-key': draftKey }
  const draftPath = `/projects/${projectId}/contributions/${draftedContribution.json.id}/delegated/${draftDelegation.json.id}`
  const drafted = await call('POST', draftPath, undefined, draftHeaders)
  assert.equal(drafted.status, 200)
  const draftedReplay = await callFresh('POST', draftPath, undefined, draftHeaders)
  assert.equal(draftedReplay.status, 200)
  const draftReceiptId = delegatedJudgmentId(C, projectId, draftedContribution.json.id, draftDelegation.json.id, draftKey)
  assert.equal(draftedReplay.json.events.filter((event: any) => event.id === draftReceiptId).length, 1,
    'a response-cache loss cannot append the same draft twice')
})

test('a keyed Delegation owns one immutable authority row beyond response-cache lifetime', async () => {
  const projectId = `p-deleg-keyed-${(n += 1)}`
  store.applyRelationOp({ kind: 'create-project', projectId, projectName: 'Durable Delegation', projectDescription: '' }, A)
  const agent = store.createAgent({ label: 'Durable delegate', providerId: 'provider-claude', tools: [] } as any, A)
  const key = `delegation-create-${n}`
  const headers = { 'x-tenant-id': A, 'idempotency-key': key }
  const request = {
    agentId: agent.id,
    actKind: 'approve-envelope',
    policy: 'Approve only reviewed monotonic work.',
    mode: 'draft',
  }
  const expectedId = delegationCreationId(A, projectId, key)

  const created = await call('POST', `/projects/${projectId}/delegations`, request, headers)
  assert.equal(created.status, 200)
  assert.equal(created.json.id, expectedId)
  const cachedReplay = await call('POST', `/projects/${projectId}/delegations`, {
    ...request,
    actKind: 'land',
    policy: 'Changed retry must not widen authority.',
    mode: 'decide',
  }, headers)
  assert.equal(cachedReplay.status, 200)
  assert.equal(cachedReplay.headers['idempotency-replayed'], 'true')
  assert.equal(cachedReplay.json.policy, request.policy)

  // A fresh router models process-local response-cache loss. Durable identity
  // must answer before changed Retry input or current roster capacity.
  const durableReplay = await callFresh('POST', `/projects/${projectId}/delegations`, {
    agentId: null,
    actKind: 'land',
    policy: '',
    mode: 'decide',
  }, headers)
  assert.equal(durableReplay.status, 200)
  assert.equal(durableReplay.headers['idempotency-replayed'], undefined)
  assert.equal(durableReplay.json.id, expectedId)
  assert.equal(durableReplay.json.actKind, request.actKind)
  assert.equal(durableReplay.json.mode, request.mode)
  assert.equal(durableReplay.json.policy, request.policy)
  const roster = store.listDelegations(projectId, A)
  assert.equal(roster.filter((delegation) => delegation.id === expectedId).length, 1,
    'durable identity, not only the response cache, prevents duplicate authority')

  const revocationKey = `delegation-revoke-${n}`
  const revocationHeaders = { 'x-tenant-id': A, 'idempotency-key': revocationKey }
  const precondition = { expectedCreatedAt: created.json.createdAt }
  const revoked = await call(
    'DELETE',
    `/projects/${projectId}/delegations/${expectedId}`,
    precondition,
    revocationHeaders,
  )
  assert.equal(revoked.status, 200)
  assert.equal(
    store.getDelegationRevocation(
      delegationRevocationId(A, projectId, expectedId, revocationKey),
      projectId,
      expectedId,
      created.json.createdAt,
      A,
    ),
    true,
    'the exact revocation receipt is durable store truth',
  )

  const durableRevocationReplay = await callFresh(
    'DELETE',
    `/projects/${projectId}/delegations/${expectedId}`,
    precondition,
    revocationHeaders,
  )
  assert.equal(durableRevocationReplay.status, 200,
    'a fresh router replays the persisted revocation after the row is absent')
  assert.equal(durableRevocationReplay.headers['idempotency-replayed'], undefined)

  const changedRevocationReplay = await callFresh(
    'DELETE',
    `/projects/${projectId}/delegations/${expectedId}`,
    { expectedCreatedAt: created.json.createdAt + 1 },
    revocationHeaders,
  )
  assert.equal(changedRevocationReplay.status, 409,
    'one revocation key cannot be redirected to a different reviewed grant')

  const invalidRevocation = await callFresh(
    'DELETE',
    `/projects/${projectId}/delegations/${expectedId}`,
    { expectedCreatedAt: created.json.createdAt, unexpected: true },
    { 'x-tenant-id': A, 'idempotency-key': `invalid-revoke-${n}` },
  )
  assert.equal(invalidRevocation.status, 400, 'unknown revocation fields fail closed')

  const resurrection = await callFresh(
    'POST',
    `/projects/${projectId}/delegations`,
    request,
    headers,
  )
  assert.equal(resurrection.status, 409,
    'a delayed creation Retry cannot resurrect explicitly revoked authority')
  assert.equal(store.listDelegations(projectId, A).some((delegation) => delegation.id === expectedId), false)
})

test('attention (CW9): the ledger counts, per-caller triage, and the self-proposed optimization', async () => {
  const projectId = `p-attn-${(n += 1)}`
  store.applyRelationOp({ kind: 'create-project', projectId, projectName: 'Attn', projectDescription: '' }, A)
  store.applyRelationOp({ kind: 'share-project', projectId, projectName: 'Attn', shared: true }, A)

  // Script a history: two contributions with MONOTONIC envelopes the owner
  // approves manually (the pattern), one effectful contribution pending.
  const mk = async (title: string, type: string) => {
    const c = (await call('POST', `/projects/${projectId}/contributions`, { title }, { 'x-tenant-id': B })).json
    await call('POST', `/projects/${projectId}/contributions/${c.id}/envelope`,
      { lines: [{ type, target: 't' }] }, { 'x-tenant-id': B })
    return c.id as string
  }
  const c1 = await mk('mono one', 'connector.read')
  const c2 = await mk('mono two', 'mcp.query')
  await call('POST', `/projects/${projectId}/contributions/${c1}/envelope/approve`, undefined, { 'x-tenant-id': A })
  await call('POST', `/projects/${projectId}/contributions/${c2}/envelope/approve`, undefined, { 'x-tenant-id': A })
  const c3 = await mk('effectful', 'charge')

  // The OWNER's view: 2 human acts; asks = approve c3's envelope (liability);
  // the proposal fires (2 manual monotonic approvals, no delegation standing).
  const owner = (await call('GET', `/projects/${projectId}/attention`, undefined, { 'x-tenant-id': A })).json
  assert.equal(owner.humanActs, 2)
  assert.equal(owner.delegatedActs, 0)
  assert.equal(owner.escalations, 0)
  assert.deepEqual(owner.asks.map((a: any) => [a.contributionId, a.function]), [[c3, 'liability']])
  assert.match(owner.proposal, /2 of your approvals were monotonic-only/, 'the mechanical pattern-match speaks')

  // The CONTRIBUTOR's view: their own error-catching path (tier-1 next steps),
  // never the owner's liability asks.
  const contributor = (await call('GET', `/projects/${projectId}/attention`, undefined, { 'x-tenant-id': B })).json
  assert.equal(contributor.proposal, undefined, 'the proposal is the owner’s instrument')
  assert.ok(contributor.asks.every((a: any) => a.function === 'error-catching'))
  assert.ok(contributor.asks.some((a: any) => /Crystallize a changeset/.test(a.label)))

  // A BYSTANDER sees the public counts and no asks at all.
  const bystander = (await call('GET', `/projects/${projectId}/attention`, undefined, { 'x-tenant-id': C })).json
  assert.equal(bystander.humanActs, 2, 'counts are public-timeline arithmetic')
  assert.deepEqual(bystander.asks, [])

  // Minting an approve-envelope delegation withdraws the proposal — the
  // optimization is "not yet held", never nagging past adoption.
  const agent2 = store.createAgent({ label: 'holder', providerId: 'provider-claude', tools: [] } as any, A)
  store.createDelegation(projectId, { agentId: (agent2 as any).id, actKind: 'approve-envelope', policy: 'hold the routine' }, A)
  const after = (await call('GET', `/projects/${projectId}/attention`, undefined, { 'x-tenant-id': A })).json
  assert.equal(after.proposal, undefined)

  // The wall: a foreign private project's ledger 404s like everything else.
  const privId = `p-attn-priv-${(n += 1)}`
  store.applyRelationOp({ kind: 'create-project', projectId: privId, projectName: 'P', projectDescription: '' }, A)
  const hidden = await call('GET', `/projects/${privId}/attention`, undefined, { 'x-tenant-id': B })
  assert.equal(hidden.status, 404)
})

test('the in-flight lease is revealed: project sub-goal holds carry at/expiresAt (CW1)', async () => {
  const projectId = `p-contrib-lease-${(n += 1)}`
  store.applyRelationOp({ kind: 'create-project', projectId, projectName: 'Lease', projectDescription: '' }, A)
  // Sharing assigns the guardianId (the created-project convention) — an
  // unguarded project has no reservation ledger to project.
  store.applyRelationOp({ kind: 'share-project', projectId, projectName: 'Lease', shared: true }, A)
  const reserved = await call('POST', `/projects/${projectId}/subgoals`, { holder: SELF_PROJECT_HOLDER, subGoal: 'lease-goal' }, { 'x-tenant-id': A })
  assert.equal(reserved.status, 200)
  const holds = (await call('GET', `/projects/${projectId}/subgoals`, undefined, { 'x-tenant-id': A })).json
  const hold = holds.find((s: any) => s.subGoal === 'lease-goal')
  assert.ok(hold, 'the hold is projected')
  assert.equal(typeof hold.at, 'number', 'claimed-when rides the projection (pure reveal)')
  assert.equal(typeof hold.expiresAt, 'number', 'the lease rides the projection')
  assert.ok(hold.expiresAt > hold.at, 'a lease is a future deadline')
})
