import assert from 'node:assert/strict'
import { test } from 'node:test'
import { store } from '../store/index.ts'
import { call, callFresh } from '../testkit/http.ts'

const owner = 'tenant-artifact-deletion-owner'
const reader = 'tenant-beta'
const headers = (tenant: string, extra: Record<string, string> = {}) => ({ 'x-tenant-id': tenant, ...extra })

test('permanent deletion is reviewed, owner-only, cascade-bound and exactly replayable', async () => {
  const stamp = Date.now()
  const creationKey = `delete-create-${stamp}`
  const created = await call('POST', '/artifacts', {
    name: `Delete cascade ${stamp}.md`, kind: 'doc', body: 'Initial retained text.\n\nSecond block.',
  }, headers(owner, { 'idempotency-key': creationKey }))
  assert.equal(created.status, 201)
  const id = created.json.artifact.id as string
  assert.equal((await call('PATCH', `/artifacts/${id}/content`, {
    block: 0, text: 'Edited retained text.', expectedRevision: 0,
  }, headers(owner))).status, 200)
  assert.equal((await call('POST', '/grants', {
    subject: { kind: 'artifact', id }, audience: { kind: 'org', orgId: reader }, tier: 'view',
  }, headers(owner))).status, 200)
  const sharedNotification = store.listNotifications(reader).find((row) => row.subjectKind === 'artifact' && row.subjectId === id)
  assert.ok(sharedNotification, 'the share creates a real audience inbox row for the artifact')
  const discussion = await call('POST', '/discussions', {
    anchor: { ref: { kind: 'artifact', id } }, firstPost: 'An artifact-only discussion.',
  }, headers(owner))
  assert.equal(discussion.status, 200)
  const proposal = await call('POST', '/proposals', {
    subject: { kind: 'artifact', id },
    delta: { kind: 'artifact-patch', block: 0, text: 'Suggested text.' },
    rationale: 'A retained proposal.',
  }, headers(owner))
  assert.equal(proposal.status, 200)
  const graphKey = `delete-graph-ack-${stamp}`
  const graphOp = { op: { kind: 'refile-artifact', artifactId: id, artifactName: `Delete cascade ${stamp}.md`, projectId: null, projectName: '' } }
  const oldGraphAck = await call('POST', '/relations/ops', graphOp, headers(owner, { 'idempotency-key': graphKey }))
  assert.equal(oldGraphAck.status, 200)
  const unrelatedProject = store.createProject({ name: `Deletion revision target ${stamp}` }, owner).project
  const relationProposal = await call('POST', '/proposals', {
    subject: { kind: 'project', id: unrelatedProject.id },
    delta: { kind: 'relation-op', op: { kind: 'share-project', projectId: unrelatedProject.id, projectName: unrelatedProject.name, shared: true } },
    rationale: 'This proposal must become stale when the graph changes.',
  }, headers(owner))
  assert.equal(relationProposal.status, 200)
  assert.equal((await call('PATCH', `/artifacts/${id}/lifecycle`, {
    state: 'trashed', expectedRevision: 0,
  }, headers(owner))).status, 200)
  const unrelatedConversation = store.createSession('Preserve unrelated conversation.', owner)
  store.recordAudit({ channel: 'host-invoke', capability: 'test.preserved', target: 'unrelated', outcome: 'fulfilled', tenantId: owner })
  const auditCount = store.listAuditLog(owner).length

  assert.equal((await call('GET', `/artifacts/${id}/deletion-preview`, undefined, headers(reader))).status, 404)
  assert.equal((await call('GET', `/artifacts/${id}/deletion-preview`, undefined, headers('tenant-foreign-delete'))).status, 404)
  assert.equal((await call('DELETE', `/artifacts/${id}`, {
    expectedLifecycleRevision: 1, reviewToken: 'a'.repeat(64),
  }, headers(owner))).status, 400, 'destructive DELETE requires an exact idempotency key')
  const previewResponse = await call('GET', `/artifacts/${id}/deletion-preview`, undefined, headers(owner))
  assert.equal(previewResponse.status, 200)
  assert.deepEqual(previewResponse.json.counts, { versions: 2, shares: 1, discussions: 2, proposals: 1 })
  const preview = previewResponse.json
  store.markNotificationsRead(reader, [sharedNotification.id])
  assert.deepEqual(store.notificationReadState(reader, [sharedNotification.id]), [{ id: sharedNotification.id, read: true }],
    'reading the inbox notification after review is incidental and does not change the reviewed cascade')

  const key = `delete-exact-${stamp}`
  const path = `/artifacts/${id}`
  const request = { expectedLifecycleRevision: preview.lifecycleRevision, reviewToken: preview.reviewToken }
  const graphRevisionBeforeDeletion = store.relationGraph(owner).revision ?? 0
  const first = await call('DELETE', path, request, headers(owner, { 'idempotency-key': key }))
  assert.equal(first.status, 200, JSON.stringify(first.json))
  assert.deepEqual(first.json, { artifactId: id, deleted: true })
  assert.equal(store.relationGraph(owner).revision, graphRevisionBeforeDeletion + 1,
    'permanent deletion participates in monotonic graph ordering')
  const graphProposalAfterDeletion = await call('GET', `/proposals?kind=project&id=${unrelatedProject.id}`, undefined, headers(owner))
  assert.equal(graphProposalAfterDeletion.json.find((row: any) => row.id === relationProposal.json.id)?.stale, true,
    'an existing relation-op proposal cannot remain fresh across artifact removal')
  assert.equal((await call('GET', `/artifacts/${id}`, undefined, headers(owner))).status, 404)
  assert.equal((await call('GET', `/artifacts/${id}/history`, undefined, headers(owner))).status, 404)
  assert.equal((await call('GET', `/discussions/${discussion.json.id}`, undefined, headers(owner))).status, 404)
  assert.equal((await call('GET', `/proposals/${proposal.json.id}`, undefined, headers(owner))).status, 404)
  assert.equal((await call('GET', '/artifact-content', undefined, headers(owner))).json[id], undefined)
  assert.equal((await callFresh('POST', '/relations/ops', graphOp, headers(owner, {
    'idempotency-key': graphKey,
  }))).status, 404, 'a pre-deletion full-graph acknowledgement cannot disclose the retired row')
  assert.ok(store.listSessions(owner).some((session) => session.id === unrelatedConversation.id), 'unrelated conversations survive')
  assert.equal(store.listAuditLog(owner).length, auditCount, 'permanent deletion does not erase audit history')
  assert.equal(store.eventVisibleToTenant({ type: 'artifact.changed', artifactId: id }, owner), true,
    'the retirement hint remains owner-scoped after the row disappears')
  assert.equal(store.eventVisibleToTenant({ type: 'artifact.changed', artifactId: id }, reader), false,
    'an absent retired id does not fall through to seed-wide event visibility')

  const replay = await callFresh('DELETE', path, request, headers(owner, { 'idempotency-key': key }))
  assert.equal(replay.status, 200)
  assert.deepEqual(replay.json, first.json, 'a lost acknowledgement resolves from the durable exact receipt')
  const changed = await callFresh('DELETE', path, { ...request, expectedLifecycleRevision: 0 }, headers(owner, { 'idempotency-key': key }))
  assert.equal(changed.status, 409, 'the same principal key cannot acknowledge changed intent')
  assert.equal((await call('POST', '/artifacts', {
    name: `Delete cascade ${stamp}.md`, kind: 'doc', body: 'Resurrection attempt.',
  }, headers(owner, { 'idempotency-key': creationKey }))).status, 400, 'retired deterministic creation IDs cannot be reused')
})

test('deletion requires Trash and a still-current review token', async () => {
  const stamp = Date.now()
  const created = await call('POST', '/artifacts', {
    name: `Review drift ${stamp}.md`, kind: 'doc', body: 'Review me.',
  }, headers(owner, { 'idempotency-key': `delete-drift-${stamp}` }))
  const id = created.json.artifact.id as string
  assert.equal((await call('GET', `/artifacts/${id}/deletion-preview`, undefined, headers(owner))).status, 409)
  assert.equal((await call('GET', `/artifacts/${id}/deletion-preview`, undefined, headers(owner, {
    'x-account-transition-source': 'session:not-current',
  }))).status, 409, 'account source is checked before exposing the reviewed cascade')
  const grant = await call('POST', '/grants', {
    subject: { kind: 'artifact', id }, audience: { kind: 'org', orgId: reader }, tier: 'view',
  }, headers(owner))
  assert.equal(grant.status, 200)
  await call('PATCH', `/artifacts/${id}/lifecycle`, { state: 'trashed', expectedRevision: 0 }, headers(owner))
  const oldPreview = (await call('GET', `/artifacts/${id}/deletion-preview`, undefined, headers(owner))).json
  await call('DELETE', `/grants/${grant.json.id}`, undefined, headers(owner))
  assert.equal((await call('DELETE', `/artifacts/${id}`, {
    expectedLifecycleRevision: oldPreview.lifecycleRevision, reviewToken: oldPreview.reviewToken,
  }, headers(owner, { 'idempotency-key': `delete-drift-stale-${stamp}` }))).status, 409,
  'changing cascade membership invalidates an existing review token')
  const preview = (await call('GET', `/artifacts/${id}/deletion-preview`, undefined, headers(owner))).json
  assert.equal((await call('DELETE', `/artifacts/${id}`, {
    expectedLifecycleRevision: preview.lifecycleRevision, reviewToken: preview.reviewToken,
  }, headers(owner, { 'idempotency-key': `delete-stale-source-${stamp}`, 'x-account-transition-source': 'session:not-current' }))).status, 409)
  assert.equal((await call('GET', `/artifacts/${id}/lifecycle`, undefined, headers(owner))).json.lifecycle.state, 'trashed')
  assert.equal((await call('DELETE', `/artifacts/${id}`, {
    expectedLifecycleRevision: preview.lifecycleRevision, reviewToken: preview.reviewToken,
  }, headers(owner, { 'idempotency-key': `delete-drift-request-${stamp}` }))).status, 200)
})
