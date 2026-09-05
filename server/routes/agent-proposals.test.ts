/** D25 — a definition evolves in the open: versions, change proposals, the merge
 *  (docs/agent-commons.md; the GitHub-parity ledger rows 4/6). The invariants under
 *  test: proposing needs the directory's wall (published-only; unpublished ≡ unknown
 *  404); only definition fields ride a proposal (capability is unrepresentable);
 *  the review queue is owner-sees-all / proposer-sees-own; verdicts are OWNER-only
 *  by raw tenant id (the D23 lesson); a merge applies fields + bumps the version +
 *  credits the proposer in the changelog (authorship ≠ D13 reputation); published
 *  owner-edits version too, private edits don't; forks record the taken version;
 *  the proposer's raw tenant id never crosses the wire. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { agentProposalCreationId } from '../agentProposalCreationIdentity.ts'
import { store } from '../store/index.ts'
import { call, callFresh } from '../testkit/http.ts'

const A = 'tenant-prop-A' // definition owner
const B = 'tenant-prop-B' // proposer
const C = 'tenant-prop-C' // bystander
let n = 0

async function publishedAgent() {
  const agent = store.createAgent(
    { label: `Evolvable ${(n += 1)}`, systemPrompt: 'v1 prompt', tools: ['create_artifact'], instructions: 'be good' },
    A,
  )
  await call('PATCH', `/agents/${agent.id}`, { published: true }, { 'x-tenant-id': A })
  return agent
}

const propose = (agentId: string, tenant: string, fields: Record<string, unknown>, note?: string) =>
  call('POST', `/agents/${agentId}/proposals`, { fields, note }, { 'x-tenant-id': tenant })

test('the propose wall is the directory’s: unpublished ≡ unknown (404); empty proposals 400', async () => {
  const priv = store.createAgent({ label: `Private ${(n += 1)}`, systemPrompt: 'x', tools: [], instructions: '' }, A)
  const hidden = await propose(priv.id, B, { systemPrompt: 'better' })
  const ghost = await propose('agent-no-such', B, { systemPrompt: 'better' })
  assert.equal(hidden.status, 404)
  assert.equal(ghost.status, 404)
  assert.equal(hidden.json.error.code, ghost.json.error.code, 'no existence leak')

  const agent = await publishedAgent()
  const empty = await propose(agent.id, B, {})
  assert.equal(empty.status, 400, 'at least one definition field required')
})

test('open → review: owner sees all, the proposer sees their own, a bystander sees neither; owner’s bell rings', async () => {
  const agent = await publishedAgent()
  const opened = await propose(agent.id, B, { systemPrompt: '  v2 prompt — sharper  ' }, 'tightens the intro')
  assert.equal(opened.status, 200)
  assert.equal(opened.json.status, 'open')
  assert.equal(opened.json.proposedBy, B)
  assert.equal(opened.json.baseVersion, 1)
  assert.equal(opened.json.fields.systemPrompt, 'v2 prompt — sharper', 'trimmed')

  const ownerView = await call('GET', `/agents/${agent.id}/proposals`, undefined, { 'x-tenant-id': A })
  assert.equal(ownerView.json.length, 1, 'the owner reviews everything')
  const proposerView = await call('GET', `/agents/${agent.id}/proposals`, undefined, { 'x-tenant-id': B })
  assert.equal(proposerView.json.length, 1, 'the proposer tracks their own')
  const bystanderView = await call('GET', `/agents/${agent.id}/proposals`, undefined, { 'x-tenant-id': C })
  assert.equal(bystanderView.json.length, 0, 'a proposal is proposer↔owner, not a public feed')
  for (const view of [opened.json, ownerView.json, proposerView.json]) {
    assert.ok(!JSON.stringify(view).includes('proposedByTenant'), 'the raw tenant id never rides the wire')
  }

  const bell = (await call('GET', '/notifications', undefined, { 'x-tenant-id': A })).json
  assert.ok(bell.some((x: any) => x.kind === 'proposal.opened' && x.agentId === agent.id), 'the owner hears the proposal')
})

test('keyed proposal creation survives acknowledgement-cache loss without duplicating the proposal or owner bell', async () => {
  const agent = await publishedAgent()
  const key = `agent-proposal-${agent.id}`
  const headers = { 'x-tenant-id': B, 'idempotency-key': key }
  const expectedId = agentProposalCreationId(B, agent.id, key)
  const beforeBells = (await call('GET', '/notifications', undefined, { 'x-tenant-id': A })).json
    .filter((entry: any) => entry.kind === 'proposal.opened' && entry.agentId === agent.id).length
  const first = await call('POST', `/agents/${agent.id}/proposals`, {
    fields: { systemPrompt: 'One durable proposal.' },
    note: 'Freeze this authored intent.',
  }, headers)
  assert.equal(first.status, 200)
  assert.equal(first.json.id, expectedId)

  const cached = await call('POST', `/agents/${agent.id}/proposals`, {
    fields: { systemPrompt: 'Changed retry input must not replace the first intent.' },
  }, headers)
  assert.equal(cached.status, 200)
  assert.equal(cached.headers['idempotency-replayed'], 'true')
  assert.deepEqual(cached.json, first.json)

  const durable = await callFresh('POST', `/agents/${agent.id}/proposals`, {}, headers)
  assert.equal(durable.status, 200, 'the represented proposal answers before changed retry input is parsed')
  assert.deepEqual(durable.json, first.json)
  assert.equal(durable.headers['idempotency-replayed'], undefined, 'durability does not depend on middleware memory')

  const rows = (await callFresh('GET', `/agents/${agent.id}/proposals`, undefined, { 'x-tenant-id': B })).json
  assert.equal(rows.filter((proposal: any) => proposal.id === expectedId).length, 1)
  const afterBells = (await call('GET', '/notifications', undefined, { 'x-tenant-id': A })).json
    .filter((entry: any) => entry.kind === 'proposal.opened' && entry.agentId === agent.id).length
  assert.equal(afterBells, beforeBells + 1, 'the owner is notified exactly once')
})

test('merge: fields land, version bumps, the changelog credits the PROPOSER, the bell rings', async () => {
  const agent = await publishedAgent()
  const revision = store.listAgents(A).find((candidate) => candidate.id === agent.id)?.revision ?? 0
  const opened = await propose(agent.id, B, { systemPrompt: 'v2 prompt', instructions: 'be better' }, 'sharper + kinder')
  const merged = await call('POST', `/agents/${agent.id}/proposals/${opened.json.id}/merge`, undefined, { 'x-tenant-id': A })
  assert.equal(merged.status, 200)
  assert.equal(merged.json.status, 'merged')

  const entry = store.agentDirectory(C).find((e) => e.id === agent.id)!
  assert.equal(entry.systemPrompt, 'v2 prompt', 'the definition changed')
  assert.equal(entry.instructions, 'be better')
  assert.equal(entry.version, 2, 'the merge versioned')
  assert.equal(
    store.listAgents(A).find((candidate) => candidate.id === agent.id)?.revision,
    revision + 1,
    'the proposal write path advances the same configuration revision as owner edits',
  )
  const line = entry.changelog.find((l) => l.version === 2)!
  assert.equal(line.author, B, 'authorship is the proposer’s — provenance, not reputation')
  assert.equal(line.note, 'sharper + kinder')
  assert.ok(!store.listAgents(A).some((a) => a.id === agent.id && (a.contributions ?? 0) > 0), 'no D13 reputation from prompt-golf')

  const bell = (await call('GET', '/notifications', undefined, { 'x-tenant-id': B })).json
  assert.ok(bell.some((x: any) => x.kind === 'proposal.merged' && x.agentId === agent.id), 'the proposer hears the merge')
})

test('decline carries the owner’s note; verdicts are owner-only by tenant id; resolved is final', async () => {
  const agent = await publishedAgent()
  const opened = await propose(agent.id, B, { instructions: 'different' })

  // The PROPOSER cannot merge their own proposal (nor can a bystander).
  const selfMerge = await call('POST', `/agents/${agent.id}/proposals/${opened.json.id}/merge`, undefined, { 'x-tenant-id': B })
  assert.equal(selfMerge.status, 403)
  const declined = await call('POST', `/agents/${agent.id}/proposals/${opened.json.id}/decline`, { note: 'out of scope' }, { 'x-tenant-id': A })
  assert.equal(declined.json.status, 'declined')
  assert.equal(declined.json.responseNote, 'out of scope')
  const again = await call('POST', `/agents/${agent.id}/proposals/${opened.json.id}/merge`, undefined, { 'x-tenant-id': A })
  assert.equal(again.status, 409, 'a resolved proposal is final')
  const bell = (await call('GET', '/notifications', undefined, { 'x-tenant-id': B })).json
  assert.ok(bell.some((x: any) => x.kind === 'proposal.declined' && x.agentId === agent.id))
})

test('published owner-edits version (with changelog); private edits are drafts; forks record the taken version', async () => {
  const agent = await publishedAgent()
  await call('PATCH', `/agents/${agent.id}`, { label: `Evolvable ${n} v2` }, { 'x-tenant-id': A })
  let entry = store.agentDirectory(C).find((e) => e.id === agent.id)!
  assert.equal(entry.version, 2, 'a published definition edit versions')
  assert.equal(entry.changelog.find((l) => l.version === 2)?.author, A, 'authored by the owner')

  // A stale proposal: authored at v2, reviewed after another edit → baseVersion < current.
  const stale = await propose(agent.id, B, { instructions: 'authored against v2' })
  await call('PATCH', `/agents/${agent.id}`, { instructions: 'owner moved on' }, { 'x-tenant-id': A })
  entry = store.agentDirectory(C).find((e) => e.id === agent.id)!
  assert.equal(entry.version, 3)
  assert.ok(stale.json.baseVersion < entry.version, 'staleness is derivable (flagged, never auto-rebased)')

  // Fork lineage records the version taken.
  const forked = await call('POST', `/agents/${agent.id}/fork`, undefined, { 'x-tenant-id': B })
  assert.equal(forked.json.forkedFrom.version, 3)

  // A PRIVATE agent's edits don't version — drafts aren't history.
  const draft = store.createAgent({ label: `Draft ${(n += 1)}`, systemPrompt: 'x', tools: [], instructions: '' }, A)
  await call('PATCH', `/agents/${draft.id}`, { label: 'renamed draft' }, { 'x-tenant-id': A })
  assert.equal(store.listAgents(A).find((a) => a.id === draft.id)?.version, undefined)
})

test('a merged bespoke prompt survives an unrelated owner edit (review finding)', async () => {
  const agent = await publishedAgent()
  const opened = await propose(agent.id, B, { systemPrompt: 'the merged bespoke prompt' })
  await call('POST', `/agents/${agent.id}/proposals/${opened.json.id}/merge`, undefined, { 'x-tenant-id': A })

  // The owner renames WITHOUT touching the prompt binding (the fixed dialog omits
  // systemPromptId when the picker is untouched) — the merged prompt must survive.
  const renamed = await call('PATCH', `/agents/${agent.id}`, { label: 'Renamed after merge' }, { 'x-tenant-id': A })
  assert.equal(renamed.json.systemPrompt, 'the merged bespoke prompt', 'an absent binding keeps the bespoke prompt')
  // The regression shape: sending systemPromptId '' resolves to the DEFAULT body —
  // which is why the dialog must only send the binding when it actually changed.
  const cleared = await call('PATCH', `/agents/${agent.id}`, { systemPromptId: '' }, { 'x-tenant-id': A })
  assert.notEqual(cleared.json.systemPrompt, 'the merged bespoke prompt', 'an EXPLICIT clear is a real act (resets to default)')
})

test('verdict walls hide existence like every sibling: unpublished + foreign ⇒ 404, never 403 (review finding)', async () => {
  const agent = await publishedAgent()
  const opened = await propose(agent.id, B, { instructions: 'pending when unpublished' })
  await call('PATCH', `/agents/${agent.id}`, { published: false }, { 'x-tenant-id': A })

  // A bystander probing a guessable proposal id on the now-invisible agent: 404
  // (a 403 would confirm "alive, with proposals").
  const probe = await call('POST', `/agents/${agent.id}/proposals/${opened.json.id}/merge`, undefined, { 'x-tenant-id': C })
  assert.equal(probe.status, 404)
  // The OWNER can still resolve the queue of their unpublished agent.
  const merged = await call('POST', `/agents/${agent.id}/proposals/${opened.json.id}/merge`, undefined, { 'x-tenant-id': A })
  assert.equal(merged.status, 200)
})

test('D27 — the thread: two parties discuss, bells ring the OTHER end, outsiders get 404, verdict closes it', async () => {
  const agent = await publishedAgent()
  const opened = await propose(agent.id, B, { instructions: 'discuss me' }, 'why this?')

  // The proposer opens the discussion → the OWNER's bell.
  const first = await call('POST', `/agents/${agent.id}/proposals/${opened.json.id}/comments`, { body: 'happy to adjust the tone' }, { 'x-tenant-id': B })
  assert.equal(first.status, 200)
  assert.equal(first.json.comments.length, 1)
  assert.equal(first.json.comments[0].author, B)
  const ownerBell = (await call('GET', '/notifications', undefined, { 'x-tenant-id': A })).json
  assert.ok(ownerBell.some((x: any) => x.kind === 'proposal.commented' && x.agentId === agent.id), 'the owner hears the comment')

  // The owner replies → the PROPOSER's bell (never the actor's own).
  await call('POST', `/agents/${agent.id}/proposals/${opened.json.id}/comments`, { body: 'tone is fine — tighten the intro' }, { 'x-tenant-id': A })
  const proposerBell = (await call('GET', '/notifications', undefined, { 'x-tenant-id': B })).json
  assert.ok(proposerBell.some((x: any) => x.kind === 'proposal.commented' && x.agentId === agent.id), 'the proposer hears the reply')

  // A bystander — who can SEE the published agent — still gets 404 on its thread:
  // a proposal is a two-party conversation, not a public feed.
  const outsider = await call('POST', `/agents/${agent.id}/proposals/${opened.json.id}/comments`, { body: 'me too' }, { 'x-tenant-id': C })
  assert.equal(outsider.status, 404)

  // The verdict ends the conversation.
  await call('POST', `/agents/${agent.id}/proposals/${opened.json.id}/decline`, { note: 'thanks anyway' }, { 'x-tenant-id': A })
  const after = await call('POST', `/agents/${agent.id}/proposals/${opened.json.id}/comments`, { body: 'one more thing' }, { 'x-tenant-id': B })
  assert.equal(after.status, 409)
})

test('D27 — the check rides prompt-changing proposals: knowable facts, never a fabricated score', async () => {
  // The published agent binds the seeded library prompt (targetFamily 'claude' via
  // createAgent's default) — actually bespoke here, so bind one explicitly.
  const prompt = store.createSystemPrompt({ label: `Check base ${(n += 1)}`, body: 'base', targetFamily: 'claude' }, A)
  const agent = store.createAgent({ label: `Checked ${n}`, systemPrompt: 'base', systemPromptId: prompt.id, tools: [], instructions: '' }, A)
  await call('PATCH', `/agents/${agent.id}`, { published: true }, { 'x-tenant-id': A })

  const withPrompt = await propose(agent.id, B, { systemPrompt: 'bespoke replacement' })
  assert.ok(withPrompt.json.check, 'a prompt change carries the check')
  assert.equal(withPrompt.json.check.replacesFamily, 'claude', 'names the tag the merge would discard')
  assert.ok(withPrompt.json.check.providerFamily, 'names the family it will run on')
  assert.match(withPrompt.json.check.note, /probe after merging/i)
  assert.equal('score' in withPrompt.json.check, false, 'no fabricated score on untagged text')

  const withoutPrompt = await propose(agent.id, B, { instructions: 'no prompt change' })
  assert.equal(withoutPrompt.json.check, undefined, 'nothing to check when the prompt is untouched')
})

test('D27 — a merged proposal lands on the PROPOSER’s public profile as authorship', async () => {
  const agent = await publishedAgent()
  const opened = await propose(agent.id, B, { instructions: 'authored credit' }, 'make it mine')
  await call('POST', `/agents/${agent.id}/proposals/${opened.json.id}/merge`, undefined, { 'x-tenant-id': A })

  const profile = (await call('GET', `/directory/owners/${encodeURIComponent(B)}`, undefined, { 'x-tenant-id': C })).json
  const authored = profile.activity.find((a: any) => a.kind === 'authored' && a.agentLabel === agent.label)
  assert.ok(authored, 'the proposer’s profile shows the authorship')
  assert.equal(authored.version, 2)
  assert.equal(authored.subGoal, 'make it mine', 'the changelog note rides along')
  // S9 — the authored line carries the OTHER owner (a ref-link target, a public display
  // name) + the definition id, so it can be a live door like its posted/resolved siblings.
  assert.equal(authored.owner, A, 'the definition’s owner rides along for the ref link')
  assert.equal(authored.agentId, agent.id, 'and the definition id')

  // The OWNER's own edits never appear as "authored" on their own profile (noise).
  const ownerProfile = (await call('GET', `/directory/owners/${encodeURIComponent(A)}`, undefined, { 'x-tenant-id': C })).json
  assert.ok(!ownerProfile.activity.some((a: any) => a.kind === 'authored' && a.agentLabel === agent.label), 'own-agent history is not cross-authorship')
})

test('D27 — unpublish closes the conversation to the ex-proposer: comment 404s like the read (review finding)', async () => {
  const agent = await publishedAgent()
  const opened = await propose(agent.id, B, { instructions: 'talk to me' })
  await call('POST', `/agents/${agent.id}/proposals/${opened.json.id}/comments`, { body: 'while published — fine' }, { 'x-tenant-id': B })
  await call('PATCH', `/agents/${agent.id}`, { published: false }, { 'x-tenant-id': A })

  // The ex-proposer's WRITE moves with their READ (write-without-read is
  // incoherent, and a 200 here leaked the thread back + kept the bell channel open).
  const after = await call('POST', `/agents/${agent.id}/proposals/${opened.json.id}/comments`, { body: 'still there?' }, { 'x-tenant-id': B })
  assert.equal(after.status, 404)
  // The OWNER can still write on their own unpublished agent's queue.
  const owner = await call('POST', `/agents/${agent.id}/proposals/${opened.json.id}/comments`, { body: 'archiving this' }, { 'x-tenant-id': A })
  assert.equal(owner.status, 200)
})

test('the open-queue cap answers 409', async () => {
  const agent = await publishedAgent()
  for (let i = 0; i < 20; i += 1) {
    const r = await propose(agent.id, B, { instructions: `variant ${i}` })
    assert.equal(r.status, 200)
  }
  const over = await propose(agent.id, C, { instructions: 'one too many' })
  assert.equal(over.status, 409, 'a review queue, not a blob store')
})
