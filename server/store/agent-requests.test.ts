/** Store locks for private, person-owned Agent request history. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { accounts } from '../accounts.ts'
import { agentCreationId } from '../agentCreationIdentity.ts'
import { store } from './index.ts'

let sequence = 0
const next = (prefix: string) => `${prefix}-${++sequence}`

function member(name: string) {
  const id = next('agent-request-person')
  const created = accounts.createUser(name, `${id}@agent-request.test`, 'fixture-password', { userId: id, tenantId: `${id}-home` })
  assert.ok(created)
  return { userId: id, email: `${id}@agent-request.test` }
}

function organization(people: ReturnType<typeof member>[]) {
  const id = next('tenant-agent-request')
  assert.ok(accounts.createOrg(people[0]!.userId, 'Agent request workspace', { logicalId: id }))
  for (const person of people.slice(1)) {
    const invite = accounts.issueInvite(id, person.email, people[0]!.userId)
    assert.equal(invite.kind, 'represented')
    assert.equal(accounts.resolveInvite(invite.invite.id, person.userId, 'accept')?.kind, 'accepted')
  }
  return id
}

function agent(label: string, tenantId: string, userId: string, published = false) {
  const id = agentCreationId(tenantId, next('agent-request-agent'))
  const created = store.createAgent({ label, systemPrompt: 'A local test Agent.', tools: [], instructions: '', published },
    tenantId, { logicalId: id, ownerUserId: userId })
  assert.equal(created.id, id)
  return id
}

function fixture() {
  const requester = member('Requesting person')
  const owner = member('Receiving person')
  const observer = member('Other workspace person')
  const tenantId = organization([requester, owner, observer])
  const sourceId = agent('Requesting Agent', tenantId, requester.userId)
  const targetId = agent('Receiving Agent', tenantId, owner.userId)
  const otherId = agent('Observer Agent', tenantId, observer.userId)
  return { requester, owner, observer, tenantId, sourceId, targetId, otherId,
    requesterActor: { tenantId, userId: requester.userId }, ownerActor: { tenantId, userId: owner.userId },
    observerActor: { tenantId, userId: observer.userId } }
}

test('private Agent request history is exact-person scoped within an organization and events disclose only its id', () => {
  const f = fixture()
  const events: unknown[] = []
  const stop = store.subscribe(event => { if (event.type === 'agent-request.changed') events.push(event) })
  const input = { fromAgentId: f.sourceId, toAgentId: f.targetId, task: 'Prepare a private summary.' }
  const created = store.createAgentRequest(f.requesterActor, 'same-org-private-request', input)
  stop()

  assert.equal(created.role, 'requester')
  assert.equal(store.agentRequest(created.id, f.ownerActor)?.role, 'owner')
  assert.equal(store.agentRequest(created.id, f.observerActor), undefined)
  assert.deepEqual(store.agentRequests(f.observerActor), [])
  assert.deepEqual(events, [{ type: 'agent-request.changed', requestId: created.id }])
  assert.equal(JSON.stringify(events).includes(input.task), false)
  assert.deepEqual(store.createAgentRequest(f.requesterActor, 'same-org-private-request', input), created,
    'exact keyed retry returns the represented request')
  assert.throws(() => store.createAgentRequest(f.requesterActor, 'same-org-private-request', { ...input, task: 'Changed body.' }))

  for (const invalid of [
    { ...input, extra: 'spoofed' }, { ...input, requester: f.ownerActor }, { ...input, ownerUserId: f.requester.userId },
    { fromAgentId: f.otherId, toAgentId: f.targetId, task: 'Not owned by caller.' },
  ]) assert.throws(() => store.createAgentRequest(f.requesterActor, next('closed-input'), invalid))
})

test('request creation supports a visible Agent in another tenant but rejects unbound and legacy sources', () => {
  const requester = member('Cross tenant requester')
  const targetOwner = member('Cross tenant target owner')
  const sourceId = agent('Private source', requester.userId + '-home', requester.userId)
  const targetId = agent('Published target', targetOwner.userId + '-home', targetOwner.userId, true)
  const actor = { tenantId: requester.userId + '-home', userId: requester.userId }
  const target = store.createAgentRequest(actor, 'cross-tenant-visible-target', {
    fromAgentId: sourceId, toAgentId: targetId, task: 'Ask a published Agent across tenants.' })
  assert.equal(target.role, 'requester')
  assert.equal(store.agentRequest(target.id, { tenantId: targetOwner.userId + '-home', userId: targetOwner.userId })?.role, 'owner')

  const unbound = store.createAgent({ label: 'Unbound source', systemPrompt: 'Legacy fixture.', tools: [], instructions: '' }, actor.tenantId)
  const unpublished = agent('Unpublished foreign target', targetOwner.userId + '-home', targetOwner.userId)
  assert.throws(() => store.createAgentRequest(actor, 'unbound-source', {
    fromAgentId: unbound.id, toAgentId: targetId, task: 'No guessed creator.' }))
  assert.throws(() => store.createAgentRequest(actor, 'hidden-foreign-target', {
    fromAgentId: sourceId, toAgentId: unpublished, task: 'No hidden target.' }))
})

test('membership loss walls subsequent request reads while Agent deletion preserves private history', () => {
  const f = fixture()
  const request = store.createAgentRequest(f.requesterActor, 'retained-after-agent-removal', {
    fromAgentId: f.sourceId, toAgentId: f.targetId, task: 'Keep this request history.' })
  const ownerMembership = accounts.membership(f.owner.userId, f.tenantId)!
  accounts.memberships = accounts.memberships.filter(row => row !== ownerMembership)
  try {
    assert.equal(store.agentRequest(request.id, f.ownerActor), undefined)
    assert.deepEqual(store.agentRequests(f.ownerActor), [])
  } finally { accounts.memberships.push(ownerMembership) }

  assert.equal(store.deleteAgent(f.sourceId, 0), true)
  assert.equal(store.deleteAgent(f.targetId, 0), true)
  const requesterView = store.agentRequest(request.id, f.requesterActor)
  const ownerView = store.agentRequest(request.id, f.ownerActor)
  assert.equal(requesterView?.status, 'waiting')
  assert.equal(requesterView?.fromAgentAvailable, false)
  assert.equal(requesterView?.toAgentAvailable, false)
  assert.equal(ownerView?.id, request.id)
  assert.equal(ownerView?.task, 'Keep this request history.')
})

test('decisions enforce role and exact revision, and a repeated decision cannot apply twice', () => {
  const f = fixture()
  const request = store.createAgentRequest(f.requesterActor, 'decision-revision', {
    fromAgentId: f.sourceId, toAgentId: f.targetId, task: 'Review this request.' })
  assert.throws(() => store.decideAgentRequest(request.id, f.requesterActor, { action: 'deny', expectedRevision: 1 }))
  assert.throws(() => store.decideAgentRequest(request.id, f.observerActor, { action: 'deny', expectedRevision: 1 }))
  const denied = store.decideAgentRequest(request.id, f.ownerActor, { action: 'deny', expectedRevision: 1 })
  assert.equal(denied.status, 'denied')
  assert.equal(denied.revision, 2)
  assert.throws(() => store.decideAgentRequest(request.id, f.ownerActor, { action: 'deny', expectedRevision: 1 }))
  assert.throws(() => store.decideAgentRequest(request.id, f.ownerActor, { action: 'deny', expectedRevision: 2 }))
  assert.equal(store.agentRequest(request.id, f.ownerActor)?.revision, 2)
})
