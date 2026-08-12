/** D23 — a work item is a conversation: comments + an honest close
 *  (docs/agent-commons.md; the GitHub-parity ledger rows 1–2). The invariants under
 *  test: anyone who can SEE the project may comment (same wall as reading the
 *  backlog; a foreign private project 404s); comments are append-only, attributed by
 *  display name, trimmed + capped (per comment and per item); retract is permitted
 *  only to the poster or the Project owner, only while `open` (`done` is immutable
 *  history); and A2A `tasks/cancel` is the SAME act through the protocol edge —
 *  `retracted` → the spec's `canceled` state. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from '../store/index.ts'
import { accounts } from '../accounts.ts'
import { call } from '../testkit/http.ts'

const A = 'tenant-disc-A' // project owner
const B = 'tenant-disc-B' // poster / commenter
const C = 'tenant-disc-C' // bystander (can see, may comment, may NOT retract)
let n = 0

/** A shared project owned by A with one open item posted by B. */
async function arena() {
  const projectId = `p-disc-${(n += 1)}`
  store.applyRelationOp({ kind: 'create-project', projectId, projectName: `Disc ${n}`, projectDescription: '' }, A)
  store.applyRelationOp({ kind: 'share-project', projectId, projectName: `Disc ${n}`, shared: true }, A)
  const posted = await call(
    'POST', `/projects/${projectId}/open-subgoals`,
    { subGoal: `disc-item-${n}`, type: 'charge', target: 'budget:demo', note: '' },
    { 'x-tenant-id': B },
  )
  assert.equal(posted.status, 200)
  return { projectId, itemId: posted.json.id as string }
}

test('anyone who can see the project may comment; attribution is the display name; append-only order', async () => {
  const { projectId, itemId } = await arena()
  const first = await call('POST', `/projects/${projectId}/open-subgoals/${itemId}/comments`, { body: '  why the charge target?  ' }, { 'x-tenant-id': C })
  assert.equal(first.status, 200)
  const second = await call('POST', `/projects/${projectId}/open-subgoals/${itemId}/comments`, { body: 'it meters the demo budget' }, { 'x-tenant-id': B })
  const comments = second.json.comments
  assert.equal(comments.length, 2)
  assert.equal(comments[0].author, C, 'attribution is the public display name, like postedBy')
  assert.equal(comments[0].body, 'why the charge target?', 'trimmed')
  assert.equal(comments[1].author, B)
  assert.ok(comments[0].at <= comments[1].at, 'append-only order')
  assert.notEqual(comments[0].id, comments[1].id)

  // The thread rides the backlog read — one object, no separate visibility.
  const list = await call('GET', `/projects/${projectId}/open-subgoals`, undefined, { 'x-tenant-id': A })
  assert.equal(list.json.find((o: any) => o.id === itemId).comments.length, 2)
})

test('the discussion wall IS the project wall: a foreign private project 404s; bounds hold', async () => {
  const privId = `p-disc-priv-${(n += 1)}`
  store.applyRelationOp({ kind: 'create-project', projectId: privId, projectName: 'Private disc', projectDescription: '' }, A)
  const posted = await call('POST', `/projects/${privId}/open-subgoals`, { subGoal: 'private-item', type: 'charge', target: 'budget:demo' }, { 'x-tenant-id': A })
  const hidden = await call('POST', `/projects/${privId}/open-subgoals/${posted.json.id}/comments`, { body: 'hi' }, { 'x-tenant-id': B })
  assert.equal(hidden.status, 404, 'a project you cannot see answers like one that does not exist')

  const { projectId, itemId } = await arena()
  const empty = await call('POST', `/projects/${projectId}/open-subgoals/${itemId}/comments`, { body: '   ' }, { 'x-tenant-id': B })
  assert.equal(empty.status, 400)
  const long = await call('POST', `/projects/${projectId}/open-subgoals/${itemId}/comments`, { body: 'x'.repeat(5000) }, { 'x-tenant-id': B })
  assert.equal(long.json.comments[0].body.length, 2000, 'per-comment cap')
  const ghost = await call('POST', `/projects/${projectId}/open-subgoals/work-no-such/comments`, { body: 'hi' }, { 'x-tenant-id': B })
  assert.equal(ghost.status, 404)
})

test('the per-item comment cap answers 409, not silent growth', async () => {
  const { projectId, itemId } = await arena()
  for (let i = 0; i < 99; i += 1) {
    store.commentOnOpenSubGoal(projectId, itemId, `c${i}`, B, undefined)
  }
  const hundredth = await call('POST', `/projects/${projectId}/open-subgoals/${itemId}/comments`, { body: 'the last one' }, { 'x-tenant-id': C })
  assert.equal(hundredth.status, 200)
  assert.equal(hundredth.json.comments.length, 100)
  const over = await call('POST', `/projects/${projectId}/open-subgoals/${itemId}/comments`, { body: 'one too many' }, { 'x-tenant-id': C })
  assert.equal(over.status, 409, 'a bound, not a blob store')
})

test('retract: the poster may; the project owner may; a bystander may not; done is immutable', async () => {
  // A bystander (who CAN see and comment) cannot retract.
  const one = await arena()
  const bystander = await call('POST', `/projects/${one.projectId}/open-subgoals/${one.itemId}/retract`, undefined, { 'x-tenant-id': C })
  assert.equal(bystander.status, 403)

  // The POSTER retracts their own item on someone else's project.
  const posterRetract = await call('POST', `/projects/${one.projectId}/open-subgoals/${one.itemId}/retract`, undefined, { 'x-tenant-id': B })
  assert.equal(posterRetract.status, 200)
  assert.equal(posterRetract.json.status, 'retracted')
  assert.equal(posterRetract.json.retractedBy, B)
  assert.ok(posterRetract.json.retractedAt > 0)

  // Retracting twice: the second call finds a non-open item → 409.
  const again = await call('POST', `/projects/${one.projectId}/open-subgoals/${one.itemId}/retract`, undefined, { 'x-tenant-id': B })
  assert.equal(again.status, 409)

  // The OWNER retracts a foreign poster's item (moderation).
  const two = await arena()
  const ownerRetract = await call('POST', `/projects/${two.projectId}/open-subgoals/${two.itemId}/retract`, undefined, { 'x-tenant-id': A })
  assert.equal(ownerRetract.status, 200)
  assert.equal(ownerRetract.json.retractedBy, A)

  // A DONE item cannot be retracted — credit is immutable history.
  const three = await arena()
  const agent = store.createAgent({ label: `Disc Taker ${n}`, systemPrompt: 'x', tools: [], instructions: '' }, A)
  store.createCommission({ role: 'writer', agentId: agent.id, projectId: three.projectId, standing: true }, A)
  const taken = await call('POST', `/projects/${three.projectId}/open-subgoals`, { subGoal: `disc-done-${n}`, type: 'charge', target: 'budget:demo' }, { 'x-tenant-id': B })
  assert.equal(taken.json.status, 'done', 'the standing Contributor took it at post time')
  const revisionism = await call('POST', `/projects/${three.projectId}/open-subgoals/${taken.json.id}/retract`, undefined, { 'x-tenant-id': B })
  assert.equal(revisionism.status, 409)
})

test('retract authorization survives a display-name collision (the spoof attack, refused)', async () => {
  // Review finding: workspace names have NO uniqueness guard, so a display-name
  // comparison would let an attacker mint a colliding name and close a victim's
  // items. Run the actual attack: a workspace named EXACTLY the poster's public
  // name (in the dev seam, B's display name is its raw id) tries to retract.
  const { projectId, itemId } = await arena()
  // FWD-5 Phase 2: namespaces mint only WITH an account — the attack now signs
  // up an account whose display name (= its namespace name) collides.
  const spoofAccount = accounts.createUser(B, 'spoof@disc.example', 'spoof-pass-123')
  const spoof = spoofAccount?.tenant
  assert.ok(spoof, 'the registry happily mints the colliding name — that is the point')
  assert.equal(spoof!.name, B, 'display names collide')
  assert.notEqual(spoof!.id, B, 'tenant ids do not')

  const attack = await call('POST', `/projects/${projectId}/open-subgoals/${itemId}/retract`, undefined, { 'x-tenant-id': spoof!.id })
  assert.equal(attack.status, 403, 'authorization compares raw tenant ids, never display names')

  // The true poster still can.
  const legit = await call('POST', `/projects/${projectId}/open-subgoals/${itemId}/retract`, undefined, { 'x-tenant-id': B })
  assert.equal(legit.status, 200)
})

test('the poster’s raw tenant id never crosses the boundary (redacted from every read)', async () => {
  const { projectId, itemId } = await arena()
  const posted = await call('POST', `/projects/${projectId}/open-subgoals`, { subGoal: `redact-${n}`, type: 'charge', target: 'budget:demo' }, { 'x-tenant-id': B })
  const commented = await call('POST', `/projects/${projectId}/open-subgoals/${itemId}/comments`, { body: 'checking the wire' }, { 'x-tenant-id': C })
  const list = await call('GET', `/projects/${projectId}/open-subgoals`, undefined, { 'x-tenant-id': A })
  const task = await call('POST', `/a2a/projects/${projectId}`, { jsonrpc: '2.0', id: 1, method: 'tasks/get', params: { id: itemId } }, { 'x-tenant-id': C })
  for (const [label, payload] of [['post', posted.json], ['comment', commented.json], ['list', list.json], ['a2a task', task.json]] as const) {
    assert.ok(!JSON.stringify(payload).includes('postedByTenant'), `'postedByTenant' must not ride the ${label} response`)
  }
})

test('a retracted item leaves the open counts (directory, search) but stays on the backlog', async () => {
  const { projectId, itemId } = await arena()
  const before = store.projectDirectory(B).find((p) => p.id === projectId)
  assert.equal(before?.openWorkCount, 1)
  await call('POST', `/projects/${projectId}/open-subgoals/${itemId}/retract`, undefined, { 'x-tenant-id': B })
  const after = store.projectDirectory(B).find((p) => p.id === projectId)
  assert.equal(after?.openWorkCount, 0, 'retracted is not open')
  const found = store.searchAll(C, `disc-item-${n}`)
  assert.ok(!found.groups.some((g) => g.type === 'openWork'), 'search lists only open items')
  const list = await call('GET', `/projects/${projectId}/open-subgoals`, undefined, { 'x-tenant-id': A })
  assert.equal(list.json.find((o: any) => o.id === itemId).status, 'retracted', 'the history stays readable')
})

test('A2A message/send + taskId IS the comment act: same walls, thread as `history` (D20/D27)', async () => {
  const { projectId, itemId } = await arena()
  const continueMsg = (text: string) => ({
    jsonrpc: '2.0',
    id: 1,
    method: 'message/send',
    params: { message: { kind: 'message', role: 'user', messageId: 'm-x', taskId: itemId, parts: [{ kind: 'text', text }] } },
  })

  // A foreign agent continues the task → the comment lands on the native thread.
  const continued = await call('POST', `/a2a/projects/${projectId}`, continueMsg('can this wait until Friday?'), { 'x-tenant-id': C })
  assert.equal(continued.status, 200)
  const task = continued.json.result
  assert.equal(task.id, itemId)
  assert.ok(Array.isArray(task.history), 'the thread rides back as spec history')
  assert.equal(task.history[0].parts[0].text, 'can this wait until Friday?')
  assert.equal(task.history[0].metadata.author, C, 'the commenter’s public identity rides the message metadata')

  // One object, two dialects: the native backlog shows the same comment.
  const list = await call('GET', `/projects/${projectId}/open-subgoals`, undefined, { 'x-tenant-id': A })
  assert.equal(list.json.find((o: any) => o.id === itemId).comments[0].body, 'can this wait until Friday?')

  // Continuing an unknown task ⇒ TaskNotFound; a text part is required.
  const ghost = await call('POST', `/a2a/projects/${projectId}`, { ...continueMsg('x'), params: { message: { kind: 'message', role: 'user', messageId: 'm-y', taskId: 'work-no-such', parts: [{ kind: 'text', text: 'x' }] } } }, { 'x-tenant-id': C })
  assert.equal(ghost.json.error.code, -32001)
})

test('A2A tasks/cancel IS the retract act: same walls, `canceled` state (D20/D23)', async () => {
  const { projectId, itemId } = await arena()
  const rpc = (method: string, params?: Record<string, unknown>) => ({ jsonrpc: '2.0', id: 1, method, params })

  // A bystander's cancel is refused — the wall speaks TaskNotCancelable.
  const refused = await call('POST', `/a2a/projects/${projectId}`, rpc('tasks/cancel', { id: itemId }), { 'x-tenant-id': C })
  assert.equal(refused.json.error.code, -32002)

  // The poster cancels; the task lands in the spec's `canceled` state.
  const canceled = await call('POST', `/a2a/projects/${projectId}`, rpc('tasks/cancel', { id: itemId }), { 'x-tenant-id': B })
  assert.equal(canceled.json.result.status.state, 'canceled')
  assert.match(canceled.json.result.status.message.parts[0].text, /Retracted by/)

  // tasks/get agrees; a second cancel is TaskNotCancelable (already closed).
  const read = await call('POST', `/a2a/projects/${projectId}`, rpc('tasks/get', { id: itemId }), { 'x-tenant-id': B })
  assert.equal(read.json.result.status.state, 'canceled')
  const twice = await call('POST', `/a2a/projects/${projectId}`, rpc('tasks/cancel', { id: itemId }), { 'x-tenant-id': B })
  assert.equal(twice.json.error.code, -32002)
})
