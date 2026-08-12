/** D29 — `@mention` pulls a workspace into a work item's thread (docs/agent-commons.md;
 *  GitHub-parity Wave 4). The invariants under test:
 *   - a mention on a SHARED project rings the named workspace, even one that never
 *     watched — the whole point is to pull a participant in;
 *   - THE WALL: a mention on a PRIVATE project rings no one (naming an outsider there
 *     would leak the project's existence — the D24 stale-audience rule applied to the
 *     mention channel);
 *   - a self-mention is a no-op (the actor is always dropped);
 *   - an unregistered name notifies no one and the comment still posts (existence-hiding
 *     — the mentioner learns nothing back);
 *   - the LONGEST registered name binds, and an `@` inside a word (an email) is not a
 *     mention;
 *   - a display name borne by two workspaces rings both (the name IS the public identity);
 *   - a mentioned participant gets the more-specific `mentioned` bell, not ALSO a
 *     generic `work.commented` for the same act;
 *   - the recipient field never rides the wire. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from '../store/index.ts'
import { accounts } from '../accounts.ts'
import { call } from '../testkit/http.ts'

const OWNER = 'tenant-acme' // seeded registered namespace — display name "Ada Lovelace"
let n = 0

/** A registered namespace with a controlled display name → mentionable. FWD-5
 *  Phase 2: namespaces are minted only WITH an account (one each; the person's
 *  display name IS the namespace name), so the factory is a real signup. */
let emailSeq = 0
function workspace(name: string): { id: string; name: string } {
  const made = accounts.createUser(name, `mention-${(emailSeq += 1)}@mentions.example`, 'mention-pass-123')
  assert.ok(made, 'namespace created')
  return { id: made!.tenant.id, name: made!.tenant.name }
}

async function sharedProject(owner = OWNER): Promise<string> {
  const projectId = `p-mention-${(n += 1)}`
  store.applyRelationOp({ kind: 'create-project', projectId, projectName: `Mentions ${n}`, projectDescription: '' }, owner)
  store.applyRelationOp({ kind: 'share-project', projectId, projectName: `Mentions ${n}`, shared: true }, owner)
  return projectId
}

const inbox = async (tenant: string) =>
  (await call('GET', '/notifications', undefined, { 'x-tenant-id': tenant })).json as any[]

async function postItem(projectId: string, subGoal: string, tenant = OWNER) {
  return (
    await call('POST', `/projects/${projectId}/open-subgoals`, { subGoal, type: 'charge', target: 'budget:demo' }, { 'x-tenant-id': tenant })
  ).json
}
async function comment(projectId: string, itemId: string, body: string, tenant = OWNER) {
  return call('POST', `/projects/${projectId}/open-subgoals/${itemId}/comments`, { body }, { 'x-tenant-id': tenant })
}

test('an @mention on a shared project rings the named workspace — pulled in though it never watched', async () => {
  const target = workspace(`Zeta One ${(n += 1)}`)
  const projectId = await sharedProject()
  const sg = `m-core-${n}`
  const item = await postItem(projectId, sg)
  const res = await comment(projectId, item.id, `Hey @${target.name}, can your agent take this?`)
  assert.equal(res.status, 200)
  const got = (await inbox(target.id)).find((x) => x.kind === 'mentioned' && x.subGoal === sg)
  assert.ok(got, 'the mentioned workspace hears it')
  assert.equal(got.actor, 'Ada Lovelace', 'attributed to the commenter’s public display name')
  assert.equal(got.projectId, projectId, 'the bell is a door to the item’s project')
  assert.ok(!('tenantId' in got), 'the recipient field never rides the wire')
})

test('THE WALL: an @mention on a private project rings no one — naming an outsider would leak its existence', async () => {
  const target = workspace(`Zeta Two ${(n += 1)}`)
  const privId = `p-mention-priv-${(n += 1)}`
  store.applyRelationOp({ kind: 'create-project', projectId: privId, projectName: 'Private mentions', projectDescription: '' }, OWNER)
  const item = await postItem(privId, `mp-${n}`) // the owner posts on their own PRIVATE project
  await comment(privId, item.id, `@${target.name} look at this secret`)
  assert.ok(!(await inbox(target.id)).some((x) => x.kind === 'mentioned'), 'the outsider is never told the private project exists')
})

test('a self-mention is a no-op — the actor is always dropped', async () => {
  const projectId = await sharedProject()
  const sg = `self-${n}`
  const item = await postItem(projectId, sg)
  await comment(projectId, item.id, `@Ada Lovelace reminder to self`)
  assert.ok(!(await inbox(OWNER)).some((x) => x.kind === 'mentioned' && x.subGoal === sg), 'no bell for mentioning yourself')
})

test('mentioning an unregistered name notifies no one and still posts the comment (existence-hiding)', async () => {
  const projectId = await sharedProject()
  const item = await postItem(projectId, `unk-${n}`)
  const body = `@Nobody Here At All please help`
  const res = await comment(projectId, item.id, body)
  assert.equal(res.status, 200, 'the comment posts')
  assert.equal(res.json.comments.at(-1).body, body, 'stored unchanged — the mentioner learns nothing back')
})

test('the longest registered name binds, and an @ inside a word (an email) is not a mention', async () => {
  const shortWs = workspace(`Nova ${(n += 1)}`)
  const longWs = workspace(`${shortWs.name} Systems`) // shares the prefix, longer
  const projectId = await sharedProject()
  const item = await postItem(projectId, `long-${n}`)
  await comment(projectId, item.id, `ping @${longWs.name} now; email x@${shortWs.name} ignored`)
  assert.ok((await inbox(longWs.id)).some((x) => x.kind === 'mentioned'), 'the longer name binds')
  assert.ok(
    !(await inbox(shortWs.id)).some((x) => x.kind === 'mentioned'),
    'the prefix name is NOT rung — longest-match consumed the token, and the second @ follows a word char',
  )
})

test('a display name borne by two workspaces rings both — the name IS the public identity', async () => {
  const twin = `Twin ${(n += 1)}`
  const w1 = workspace(twin)
  const w2 = workspace(twin) // same display name, distinct tenant (display names have no uniqueness guard)
  const projectId = await sharedProject()
  const item = await postItem(projectId, `twin-${n}`)
  await comment(projectId, item.id, `@${twin} both of you`)
  assert.ok((await inbox(w1.id)).some((x) => x.kind === 'mentioned'), 'the first bearer rings')
  assert.ok((await inbox(w2.id)).some((x) => x.kind === 'mentioned'), 'the second bearer rings too')
})

test('the mention fan-out is hard-capped at MENTION_CAP recipients — a colliding name can’t amplify (review F1)', async () => {
  const horde = `Horde ${(n += 1)}`
  const members = Array.from({ length: 15 }, () => workspace(horde)) // 15 > MENTION_CAP (10)
  const projectId = await sharedProject()
  const sg = `horde-${n}`
  const item = await postItem(projectId, sg)
  await comment(projectId, item.id, `@${horde} everyone`)
  let rung = 0
  for (const m of members) {
    if ((await inbox(m.id)).some((x) => x.kind === 'mentioned' && x.subGoal === sg)) rung += 1
  }
  assert.ok(rung <= 10, `at most MENTION_CAP (10) bells regardless of how many bear the name; got ${rung}`)
  assert.ok(rung >= 1, 'and the mention still resolves for some')
})

test('clustered first-char names + a noise-heavy body still resolve correctly (review F2 shape)', async () => {
  // The residual F2 attack shape: many DISTINCT names sharing a first char, plus a
  // body full of near-miss `@a…` tokens. The length-descending hash resolver must
  // still pick out the one real, complete name among the noise — and only it.
  const tag = (n += 1)
  const members = Array.from({ length: 12 }, (_, k) => workspace(`a${tag}x${k}`)) // all first-char 'a', distinct
  const target = members[7]
  const projectId = await sharedProject()
  const sg = `cluster-${tag}`
  const item = await postItem(projectId, sg)
  // 200 near-miss `@a` tokens (no complete name) + one real mention of the target.
  const noise = '!@a'.repeat(200)
  await comment(projectId, item.id, `${noise} and hey @${target.name}!`)
  assert.ok((await inbox(target.id)).some((x) => x.kind === 'mentioned' && x.subGoal === sg), 'the one real name among the noise resolves')
  const others = members.filter((m) => m.id !== target.id)
  for (const m of others) {
    assert.ok(!(await inbox(m.id)).some((x) => x.kind === 'mentioned' && x.subGoal === sg), 'no near-miss token rings a sibling')
  }
})

test('the word boundary is Unicode-aware — underscore-adjacent forms are not mentions, punctuation is (review F3)', async () => {
  const ws = workspace(`Orbit ${(n += 1)}`)
  const projectId = await sharedProject()
  const noHit = await postItem(projectId, `orbit-${n}`)
  // `@Name_x` (trailing `_` is a word char → no end boundary) and `x_@Name` (`_`
  // before `@` is a word char → not a mention start) both resolve to nobody.
  await comment(projectId, noHit.id, `@${ws.name}_ping and note_@${ws.name}`)
  assert.ok(!(await inbox(ws.id)).some((x) => x.kind === 'mentioned'), 'neither underscore-adjacent form mentions')
  // A clean punctuation boundary DOES mention.
  const yesHit = await postItem(projectId, `orbit2-${n}`)
  await comment(projectId, yesHit.id, `hey @${ws.name}! look`)
  assert.ok((await inbox(ws.id)).some((x) => x.kind === 'mentioned' && x.subGoal === `orbit2-${n}`), 'a punctuation boundary mentions')
})

test('a mentioned participant gets the more-specific mention bell, not ALSO work.commented for the same act', async () => {
  const target = workspace(`Watcher Named ${(n += 1)}`)
  const projectId = await sharedProject()
  await call('POST', `/projects/${projectId}/watch`, { watching: true }, { 'x-tenant-id': target.id })
  const sg = `wm-${n}`
  const item = await postItem(projectId, sg)
  await comment(projectId, item.id, `@${target.name} heads up`)
  const rows = await inbox(target.id)
  assert.ok(rows.some((x) => x.kind === 'mentioned' && x.subGoal === sg), 'gets the mention')
  assert.ok(!rows.some((x) => x.kind === 'work.commented' && x.subGoal === sg), 'not also the generic comment bell for the same act')
})
