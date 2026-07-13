/** COMMONS-25 — "Your work", the caller's coordination dashboard (the GitHub
 *  your-issues / your-PRs analog): `GET /me/work` answers with the items THEY
 *  posted and the proposals THEY authored, and nothing else. The invariants under
 *  test: tenancy IS the filter (no parameter to widen; another tenant's acts never
 *  appear); the redaction seams hold (no raw `postedByTenant` / `proposedByTenant`
 *  crosses); visibility mirrors the entity pages (an UNSHARED project's item and an
 *  UNPUBLISHED definition's proposal drop off with the public face they rode on);
 *  ordering is open-first; and the door decorations (projectName / agentLabel /
 *  agentOwner) name the live entities. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from '../server/store.ts'
import { call } from './helpers/http.ts'

const A = 'tenant-mywork-A' // project owner / definition owner
const B = 'tenant-mywork-B' // the dashboard's caller: poster + proposer
const C = 'tenant-mywork-C' // bystander
let n = 0

async function sharedProjectWithItem(poster = B) {
  const projectId = `p-mywork-${(n += 1)}`
  const name = `MyWork arena ${n}`
  store.applyRelationOp({ kind: 'create-project', projectId, projectName: name, projectDescription: '' }, A)
  store.applyRelationOp({ kind: 'share-project', projectId, projectName: name, shared: true }, A)
  const posted = await call(
    'POST', `/projects/${projectId}/open-subgoals`,
    { subGoal: `mywork-item-${n}`, type: 'charge', target: 'budget:demo', note: '' },
    { 'x-tenant-id': poster },
  )
  assert.equal(posted.status, 200)
  return { projectId, name, itemId: posted.json.id as string, subGoal: `mywork-item-${n}` }
}

async function publishedAgentWithProposal(proposer = B) {
  const agent = store.createAgent(
    { label: `MyWork agent ${(n += 1)}`, systemPrompt: 'v1', tools: [], instructions: '' },
    A,
  )
  await call('PATCH', `/agents/${agent.id}`, { published: true }, { 'x-tenant-id': A })
  const opened = await call(
    'POST', `/agents/${agent.id}/proposals`,
    { fields: { systemPrompt: 'sharper v2' }, note: `tighten ${n}` },
    { 'x-tenant-id': proposer },
  )
  assert.equal(opened.status, 200)
  return { agent, proposalId: opened.json.id as string }
}

const myWork = (tenant: string) => call('GET', '/me/work', undefined, { 'x-tenant-id': tenant })

test('the dashboard serves the CALLER’s acts only, decorated with live door names', async () => {
  const { name, itemId, subGoal } = await sharedProjectWithItem(B)
  const { agent, proposalId } = await publishedAgentWithProposal(B)

  const mine = await myWork(B)
  assert.equal(mine.status, 200)
  const item = mine.json.posted.find((o: { id: string }) => o.id === itemId)
  assert.ok(item, 'the posted item is on the poster’s dashboard')
  assert.equal(item.subGoal, subGoal)
  assert.equal(item.projectName, name, 'decorated with the project’s live name')
  const prop = mine.json.proposals.find((p: { id: string }) => p.id === proposalId)
  assert.ok(prop, 'the authored proposal is on the proposer’s dashboard')
  assert.equal(prop.agentId, agent.id)
  assert.ok(prop.agentLabel.startsWith('MyWork agent'), 'decorated with the definition label')
  assert.ok(prop.agentOwner, 'decorated with the owner display name')

  // A bystander's dashboard carries NEITHER — tenancy is the filter itself.
  const others = await myWork(C)
  assert.equal(others.status, 200)
  assert.ok(!others.json.posted.some((o: { id: string }) => o.id === itemId))
  assert.ok(!others.json.proposals.some((p: { id: string }) => p.id === proposalId))
})

test('the redaction seams hold — no raw tenant ids cross the wire', async () => {
  await sharedProjectWithItem(B)
  await publishedAgentWithProposal(B)
  const mine = await myWork(B)
  for (const o of mine.json.posted) {
    assert.ok(!('postedByTenant' in o), 'postedByTenant stays server-private')
    assert.ok(!('postedByPrincipal' in o), 'principal refs stay server-private')
  }
  for (const p of mine.json.proposals) {
    assert.ok(!('proposedByTenant' in p), 'proposedByTenant stays server-private')
    assert.ok(!('proposedByPrincipal' in p), 'principal refs stay server-private')
  }
})

test('visibility mirrors the entity pages: unsharing / unpublishing drops the row', async () => {
  const { projectId, name, itemId } = await sharedProjectWithItem(B)
  const { agent, proposalId } = await publishedAgentWithProposal(B)

  store.applyRelationOp({ kind: 'share-project', projectId, projectName: name, shared: false }, A)
  await call('PATCH', `/agents/${agent.id}`, { published: false }, { 'x-tenant-id': A })

  const mine = await myWork(B)
  assert.ok(
    !mine.json.posted.some((o: { id: string }) => o.id === itemId),
    'an unshared project’s item drops off (no side-channel outliving the wall)',
  )
  assert.ok(
    !mine.json.proposals.some((p: { id: string }) => p.id === proposalId),
    'an unpublished definition’s proposal drops off (mirrors the proposer-read 404)',
  )

  // …and the OWNER's dashboard still shows their own acts on their private things:
  // A posts on their now-private project — visible to A (owner reads), absent for B.
  const posted = await call(
    'POST', `/projects/${projectId}/open-subgoals`,
    { subGoal: `owner-item-${n}`, type: 'charge', target: 'budget:demo' },
    { 'x-tenant-id': A },
  )
  assert.equal(posted.status, 200)
  const owners = await myWork(A)
  assert.ok(owners.json.posted.some((o: { id: string }) => o.id === posted.json.id))
})

test('open items band first, newest within each band', async () => {
  const first = await sharedProjectWithItem(B)
  const second = await sharedProjectWithItem(B)
  // Retract the NEWER item — it must band below the still-open older one.
  const retract = await call(
    'POST', `/projects/${second.projectId}/open-subgoals/${second.itemId}/retract`, undefined,
    { 'x-tenant-id': B },
  )
  assert.equal(retract.status, 200)
  const mine = await myWork(B)
  const ids = mine.json.posted.map((o: { id: string }) => o.id)
  assert.ok(
    ids.indexOf(first.itemId) < ids.indexOf(second.itemId),
    'the open item outranks the retracted one despite being older',
  )
})
