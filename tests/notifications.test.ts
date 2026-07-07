/** D24 — watching + the per-tenant notification inbox (docs/agent-commons.md; the
 *  GitHub-parity ledger row 3). The invariants under test: notifications fan out to
 *  the watchers + the Project owner + the item's poster, always MINUS the actor;
 *  a notification never tells a tenant something the walls wouldn't show it (watch
 *  needs visibility — a foreign private project 404s); the inbox is tenant-scoped
 *  and its recipient field never rides the wire; mark-read is idempotent; the
 *  per-tenant cap evicts oldest. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from '../server/store.ts'
import { call } from './helpers/http.ts'

const A = 'tenant-ntf-A' // project owner
const B = 'tenant-ntf-B' // poster
const C = 'tenant-ntf-C' // watcher
const D = 'tenant-ntf-D' // uninvolved
let n = 0

async function arena(opts: { standing?: boolean } = {}) {
  const projectId = `p-ntf-${(n += 1)}`
  store.applyRelationOp({ kind: 'create-project', projectId, projectName: `Bell ${n}`, projectDescription: '' }, A)
  store.applyRelationOp({ kind: 'share-project', projectId, projectName: `Bell ${n}`, shared: true }, A)
  if (opts.standing) {
    const agent = store.createAgent({ label: `Bell Taker ${n}`, systemPrompt: 'x', tools: [], instructions: '' }, A)
    store.createCommission({ agentId: agent.id, projectId, standing: true }, A)
  }
  const watched = await call('POST', `/projects/${projectId}/watch`, { watching: true }, { 'x-tenant-id': C })
  assert.equal(watched.status, 200)
  return { projectId }
}

const inbox = async (tenant: string) =>
  (await call('GET', '/notifications', undefined, { 'x-tenant-id': tenant })).json as any[]

test('posting fans out to watcher + owner, never the actor; comments add the poster', async () => {
  const { projectId } = await arena()
  await call('POST', `/projects/${projectId}/open-subgoals`, { subGoal: `bell-item-${n}`, type: 'charge', target: 'budget:demo' }, { 'x-tenant-id': B })

  const watcher = await inbox(C)
  const posted = watcher.find((x) => x.kind === 'work.posted' && x.subGoal === `bell-item-${n}`)
  assert.ok(posted, 'the watcher hears about the post')
  assert.equal(posted.actor, B)
  assert.equal(posted.projectId, projectId)
  assert.ok(watcher.every((x) => !('tenantId' in x)), 'the recipient field never rides the wire')
  assert.ok((await inbox(A)).some((x) => x.kind === 'work.posted' && x.subGoal === `bell-item-${n}`), 'the owner hears too')
  assert.ok(!(await inbox(B)).some((x) => x.kind === 'work.posted' && x.subGoal === `bell-item-${n}`), 'the ACTOR does not')

  // The owner comments → the POSTER (a participant) is notified; the actor is not.
  const items = (await call('GET', `/projects/${projectId}/open-subgoals`, undefined, { 'x-tenant-id': A })).json
  await call('POST', `/projects/${projectId}/open-subgoals/${items[0].id}/comments`, { body: 'on it' }, { 'x-tenant-id': A })
  assert.ok((await inbox(B)).some((x) => x.kind === 'work.commented' && x.actor === A), 'the poster hears the comment')
  assert.ok(!(await inbox(A)).some((x) => x.kind === 'work.commented' && x.subGoal === `bell-item-${n}`), 'not the commenter')
})

test('unprompted resolution notifies the poster — the bell’s whole point (D19 × D24)', async () => {
  const { projectId } = await arena({ standing: true })
  const posted = await call('POST', `/projects/${projectId}/open-subgoals`, { subGoal: `bell-auto-${n}`, type: 'charge', target: 'budget:demo' }, { 'x-tenant-id': B })
  assert.equal(posted.json.status, 'done', 'the standing Contributor took it at post time')
  const mine = await inbox(B)
  const resolved = mine.find((x) => x.kind === 'work.resolved' && x.subGoal === `bell-auto-${n}`)
  assert.ok(resolved, 'the poster learns their item was taken — without polling')
  assert.equal(resolved.actor, A, 'attributed to the resolving agent’s owner workspace (D13)')
})

test('retraction notifies; unwatching stops the bell; watching needs visibility', async () => {
  const { projectId } = await arena()
  const item = (await call('POST', `/projects/${projectId}/open-subgoals`, { subGoal: `bell-ret-${n}`, type: 'charge', target: 'budget:demo' }, { 'x-tenant-id': B })).json
  await call('POST', `/projects/${projectId}/open-subgoals/${item.id}/retract`, undefined, { 'x-tenant-id': B })
  assert.ok((await inbox(C)).some((x) => x.kind === 'work.retracted' && x.subGoal === `bell-ret-${n}`), 'the watcher hears the close')

  // Unwatch → the next act on this project stays out of C's inbox.
  await call('POST', `/projects/${projectId}/watch`, { watching: false }, { 'x-tenant-id': C })
  await call('POST', `/projects/${projectId}/open-subgoals`, { subGoal: `bell-after-${n}`, type: 'charge', target: 'budget:demo' }, { 'x-tenant-id': B })
  assert.ok(!(await inbox(C)).some((x) => x.subGoal === `bell-after-${n}`), 'unwatched = silent')

  // A foreign PRIVATE project cannot be watched — it answers like a nonexistent one.
  const privId = `p-ntf-priv-${(n += 1)}`
  store.applyRelationOp({ kind: 'create-project', projectId: privId, projectName: 'Dark bell', projectDescription: '' }, A)
  const hidden = await call('POST', `/projects/${privId}/watch`, { watching: true }, { 'x-tenant-id': C })
  assert.equal(hidden.status, 404)

  // An uninvolved tenant's inbox has none of this project's acts.
  assert.ok(!(await inbox(D)).some((x) => x.projectId === projectId), 'tenant-scoped: no bleed')
})

test('un-sharing silences the stale audience — no act on a now-private project leaks (review finding)', async () => {
  // C watched while shared; B posted while shared. Then the owner takes the
  // project private: watches and the poster anchor OUTLIVE the un-share, so
  // without a mint-time visibility re-check both would keep hearing acts —
  // including brand-new item text — that every read wall now 404s.
  const { projectId } = await arena()
  const item = (await call('POST', `/projects/${projectId}/open-subgoals`, { subGoal: `pre-privacy-${n}`, type: 'charge', target: 'budget:demo' }, { 'x-tenant-id': B })).json
  store.applyRelationOp({ kind: 'share-project', projectId, projectName: `Bell ${n}`, shared: false }, A)

  // The owner acts on the now-private project: a fresh post and a comment.
  await call('POST', `/projects/${projectId}/open-subgoals`, { subGoal: `post-privacy-${n}`, type: 'charge', target: 'budget:demo' }, { 'x-tenant-id': A })
  await call('POST', `/projects/${projectId}/open-subgoals/${item.id}/comments`, { body: 'owner-only now' }, { 'x-tenant-id': A })

  assert.ok(!(await inbox(C)).some((x) => x.subGoal === `post-privacy-${n}`), 'the ex-watcher never hears the private post')
  assert.ok(!(await inbox(C)).some((x) => x.kind === 'work.commented' && x.subGoal === `pre-privacy-${n}`), '…nor the private comment')
  assert.ok(!(await inbox(B)).some((x) => x.kind === 'work.commented' && x.subGoal === `pre-privacy-${n}`), 'the ex-poster anchor is silenced too')

  // Re-sharing restores the flow — the audience is computed at mint time.
  store.applyRelationOp({ kind: 'share-project', projectId, projectName: `Bell ${n}`, shared: true }, A)
  await call('POST', `/projects/${projectId}/open-subgoals/${item.id}/comments`, { body: 'public again' }, { 'x-tenant-id': A })
  assert.ok((await inbox(C)).some((x) => x.kind === 'work.commented' && x.subGoal === `pre-privacy-${n}`), 'a re-shared project rings again')
})

test('a fork rings the definition owner’s bell (public credit, D18 × D24)', async () => {
  const agent = store.createAgent({ label: `Bell Fork Subject ${(n += 1)}`, systemPrompt: 'x', tools: [], instructions: '' }, A)
  await call('PATCH', `/agents/${agent.id}`, { published: true }, { 'x-tenant-id': A })
  await call('POST', `/agents/${agent.id}/fork`, undefined, { 'x-tenant-id': B })
  const owner = await inbox(A)
  const forked = owner.find((x) => x.kind === 'agent.forked' && x.agentId === agent.id)
  assert.ok(forked, 'the owner hears the fork')
  assert.equal(forked.actor, B)
  assert.equal(forked.agentLabel, agent.label)
  assert.ok(!(await inbox(B)).some((x) => x.kind === 'agent.forked' && x.agentId === agent.id), 'the forker does not')
})

test('mark-read: named ids, then all; idempotent', async () => {
  const { projectId } = await arena()
  await call('POST', `/projects/${projectId}/open-subgoals`, { subGoal: `bell-read-${n}`, type: 'charge', target: 'budget:demo' }, { 'x-tenant-id': B })
  const before = await inbox(C)
  const unread = before.filter((x) => !x.read)
  assert.ok(unread.length >= 1)

  const one = await call('POST', '/notifications/read', { ids: [unread[0].id] }, { 'x-tenant-id': C })
  assert.equal(one.json.find((x: any) => x.id === unread[0].id).read, true)
  const all = await call('POST', '/notifications/read', {}, { 'x-tenant-id': C })
  assert.ok(all.json.every((x: any) => x.read === true), 'omitted ids = mark all')
  const again = await call('POST', '/notifications/read', {}, { 'x-tenant-id': C })
  assert.deepEqual(again.json, all.json, 'idempotent')
})

test('the per-tenant cap evicts oldest — a pointer cache, not a second history', async () => {
  const { projectId } = await arena()
  // 205 acts on the watched project → the watcher's inbox holds the newest 200.
  for (let i = 0; i < 205; i += 1) {
    await call('POST', `/projects/${projectId}/open-subgoals`, { subGoal: `cap-${n}-${i}`, type: 'charge', target: 'budget:demo' }, { 'x-tenant-id': B })
  }
  const mine = await inbox(C)
  const capRows = mine.filter((x) => x.subGoal?.startsWith(`cap-${n}-`))
  assert.ok(mine.length <= 200, 'capped')
  assert.ok(capRows.some((x) => x.subGoal === `cap-${n}-204`), 'newest kept')
  assert.ok(!capRows.some((x) => x.subGoal === `cap-${n}-0`), 'oldest evicted')
})
