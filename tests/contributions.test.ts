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
import { store } from '../server/store.ts'
import { call } from './helpers/http.ts'

const A = 'tenant-contrib-A' // project owner
const B = 'tenant-contrib-B' // contributor
const C = 'tenant-contrib-C' // bystander (sees, comments; may NOT land)
let n = 0

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
  const otherLanded = await call('POST', `/projects/${other.projectId}/contributions/${other.cid}/land`, undefined, { 'x-tenant-id': B })
  assert.equal(otherLanded.json.landingNumber, 1)

  // The ledger read: open band first, then landed in reverse ledger order.
  const third = await call('POST', `/projects/${one.projectId}/contributions`, { title: 'still open' }, { 'x-tenant-id': C })
  const list = (await call('GET', `/projects/${one.projectId}/contributions`, undefined, { 'x-tenant-id': A })).json
  assert.equal(list[0].id, third.json.id, 'open first')
  assert.deepEqual(list.slice(1).map((c: any) => c.landingNumber), [2, 1], 'landed newest-first (L descending)')
})

test('notes: any viewer, trimmed + capped, and the thread stays open AFTER landing (CW7)', async () => {
  const { projectId, cid } = await arena()
  const noted = await call('POST', `/projects/${projectId}/contributions/${cid}/comments`, { body: '  looks right  ' }, { 'x-tenant-id': C })
  assert.equal(noted.status, 200)
  const note = noted.json.events.find((e: any) => e.kind === 'note')
  assert.equal(note.body, 'looks right', 'trimmed')
  assert.equal(note.actor, C)

  await call('POST', `/projects/${projectId}/contributions/${cid}/land`, undefined, { 'x-tenant-id': B })
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
    store.landContribution(totalId, (c as { id: string }).id, B, undefined)
  }
  const over = await call('POST', `/projects/${totalId}/contributions`, { title: 'one too many' }, { 'x-tenant-id': B })
  assert.equal(over.status, 409, 'the 201st row is refused even with zero open')
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
    { lines: [{ type: 'not-a-type', target: 'x' }] },
    { lines: [{ type: 'charge', target: 'x', cardinality: 0 }] },
    { lines: [{ type: 'charge', target: 'x', harness: 'yolo' }] },
  ]) {
    const r = await call('POST', `/projects/${projectId}/contributions/${cid}/envelope`, bad, { 'x-tenant-id': B })
    assert.equal(r.status, 400, JSON.stringify(bad))
  }
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
  await call('POST', `/projects/${other.projectId}/contributions/${other.cid}/land`, undefined, { 'x-tenant-id': B })
  const late = await call('POST', `/projects/${other.projectId}/contributions/${other.cid}/effects`,
    { lineId: app2.json.envelope.lines[0].id }, { 'x-tenant-id': B })
  assert.equal(late.status, 409, 'a landed contribution’s plan is immutable — no act fires after landing')
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

test('the in-flight lease is revealed: project sub-goal holds carry at/expiresAt (CW1)', async () => {
  const projectId = `p-contrib-lease-${(n += 1)}`
  store.applyRelationOp({ kind: 'create-project', projectId, projectName: 'Lease', projectDescription: '' }, A)
  // Sharing assigns the guardianId (the created-project convention) — an
  // unguarded project has no reservation ledger to project.
  store.applyRelationOp({ kind: 'share-project', projectId, projectName: 'Lease', shared: true }, A)
  const reserved = await call('POST', `/projects/${projectId}/subgoals`, { holder: 'session-lease-demo', subGoal: 'lease-goal' }, { 'x-tenant-id': A })
  assert.equal(reserved.status, 200)
  const holds = (await call('GET', `/projects/${projectId}/subgoals`, undefined, { 'x-tenant-id': A })).json
  const hold = holds.find((s: any) => s.subGoal === 'lease-goal')
  assert.ok(hold, 'the hold is projected')
  assert.equal(typeof hold.at, 'number', 'claimed-when rides the projection (pure reveal)')
  assert.equal(typeof hold.expiresAt, 'number', 'the lease rides the projection')
  assert.ok(hold.expiresAt > hold.at, 'a lease is a future deadline')
})
