import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ConflictError } from '../conflict.ts'
import { artifactCreationId } from '../artifactCreationIdentity.ts'
import { store } from './index.ts'

const owner = 'tenant-artifact-trash-owner'
const reader = 'tenant-beta'
const foreign = 'tenant-artifact-trash-foreign'

function create(key: string) {
  const id = artifactCreationId(owner, key)
  const created = store.createArtifact({ name: `${key}.md`, kind: 'doc', body: 'Retained original.\n\nSecond paragraph.' }, owner, id)
  assert.ok(created && created !== 'invalid')
  return created.artifact
}

test('Trash suspends ordinary reads and writes, preserving exact content and current sharing for restore', () => {
  const artifact = create('trash-round-trip')
  const project = store.createProject({ name: 'Trash retained filing' }, owner)!.project
  store.applyRelationOp({ kind: 'refile-artifact', artifactId: artifact.id, artifactName: artifact.name, projectId: project.id, projectName: project.name }, owner)
  store.applyRelationOp({ kind: 'set-artifact-source', artifactId: artifact.id, artifactName: artifact.name, contextLabel: 'Retained context source' }, owner)
  const beforeGraph = store.relationGraph(owner)
  assert.equal(beforeGraph.artifactProject[artifact.id], project.id)
  assert.equal(beforeGraph.artifactSource[artifact.id], 'Retained context source')
  const subject = { kind: 'artifact' as const, id: artifact.id }
  const grant = store.createGrant({ subject, audience: { kind: 'org', orgId: reader }, tier: 'propose' }, owner)
  assert.equal(typeof grant, 'object')
  const bell = store.listNotifications(reader).find((notification) => notification.subjectId === artifact.id)
  assert.ok(bell, 'sharing creates a real inbox entry to suspend')
  const before = store.artifactContent(owner)[artifact.id]
  assert.ok(before)
  assert.ok(store.artifactContent(reader)[artifact.id])
  const events: any[] = []
  const off = store.subscribe((event) => events.push(event))
  const trashed = store.setArtifactLifecycle(artifact.id, 'trashed', 0, owner)
  off()
  assert.equal(trashed?.lifecycle.state, 'trashed')
  assert.equal(trashed?.artifact.lifecycleRevision, 1)
  for (const tenant of [owner, reader, foreign]) {
    assert.equal(store.listArtifacts(tenant).some((row) => row.id === artifact.id), false)
    assert.equal(store.artifactContent(tenant)[artifact.id], undefined)
    assert.equal(store.grantSubjectVisible(subject, tenant), false)
    assert.equal(store.socialSubjectCommentable(subject, tenant), false)
    assert.equal(store.exportArtifactDocument(artifact.id, tenant), undefined)
    const graph = store.relationGraph(tenant)
    assert.equal(graph.extraArtifacts.some((row) => row.id === artifact.id), false)
    assert.equal(Object.hasOwn(graph.artifactProject, artifact.id), false)
    assert.equal(Object.hasOwn(graph.artifactSource, artifact.id), false)
  }
  assert.equal(store.artifactById(artifact.id), undefined)
  assert.equal(store.renameArtifact(artifact.id, 'cannot-rename.md', 0, owner), undefined)
  assert.equal(store.updateArtifactBlock(artifact.id, 0, 'Cannot edit', 0), undefined)
  assert.equal(store.opDeniedForTenant({ kind: 'refile-artifact', artifactId: artifact.id, artifactName: artifact.name, projectId: null, projectName: '' }, owner), true)
  assert.equal(store.getArtifactCreation(artifact.id, owner), 'invalid', 'a keyed creation retry cannot mint or restore a trashed identity')
  assert.equal(store.createArtifact({ name: 'Do not recreate.md', kind: 'doc', body: 'Changed retry' }, owner, artifact.id), 'invalid')
  assert.equal(store.listTrashedArtifacts(reader).length, 0)
  assert.equal(store.listNotifications(reader).some((notification) => notification.id === bell.id), false)
  assert.equal(store.listTrashedArtifacts(foreign).length, 0)
  const row = store.listTrashedArtifacts(owner).find((item) => item.artifact.id === artifact.id)
  assert.equal(row?.trashedAt, trashed?.lifecycle.changedAt)
  assert.equal(row?.artifact.name, artifact.name)
  const event = events.find((item) => item.type === 'artifact.changed' && item.artifactId === artifact.id)
  assert.ok(event, 'transition publishes an invalidation after commit')
  assert.equal(store.eventVisibleToTenant(event, owner), true)
  assert.equal(store.eventVisibleToTenant(event, reader), true, 'former readers must invalidate cached content')
  assert.equal(store.eventVisibleToTenant(event, foreign), false)
  assert.equal(store.setArtifactLifecycle(artifact.id, 'active', 1, reader), undefined)
  assert.equal(store.setArtifactLifecycle('missing-trash-id', 'active', 1, owner), undefined)
  const restored = store.setArtifactLifecycle(artifact.id, 'active', 1, owner)
  assert.equal(restored?.artifact.id, artifact.id)
  assert.equal(restored?.artifact.lifecycleRevision, 2)
  assert.deepEqual(store.artifactContent(owner)[artifact.id], before)
  assert.deepEqual(store.artifactContent(reader)[artifact.id], before)
  assert.equal(store.listNotifications(reader).some((notification) => notification.id === bell.id), true, 'restore retains inbox history')
  assert.equal(store.relationGraph(owner).artifactProject[artifact.id], project.id)
  assert.equal(store.relationGraph(owner).artifactSource[artifact.id], 'Retained context source')
  assert.equal(store.getArtifactCreation(artifact.id, owner)?.artifact?.id, artifact.id)
  assert.equal(store.listTrashedArtifacts(owner).some((item) => item.artifact.id === artifact.id), false)
})

test('routine delivery fails visibly while its stable output is in Trash, including a late transition', () => {
  const { id: _id, ...seed } = structuredClone(store.listSchedules()[0]!)
  const tenant = 'tenant-personal'
  const task = store.addSchedule({ ...seed, tenantId: tenant, name: 'Trash routine output', runs: [], enabled: false,
    steps: [], delivery: { tool: { id: 'claude', label: 'Claude', tone: 'claude' }, target: 'Run conversation' } })
  const finish = (runId: string, content: string) => store.completeScheduleRun(task.id, runId,
    { id: 'trash-result', role: 'assistant', content }, { agentId: 'test-agent', providerId: 'test-provider' })!
  try {
    store.applyRelationOp({ kind: 'set-schedule-artifact', scheduleId: task.id, scheduleName: task.name, cadence: task.cadence, artifactName: 'Retain routine report.md' })
    assert.equal(finish(store.runSchedule(task.id)!.id, 'Original report.').status, 'ok')
    const artifact = store.listArtifacts(tenant).find((row) => row.sourceScheduleId === task.id)!
    assert.ok(artifact)
    const before = structuredClone(store.artifactContent(tenant)[artifact.id])
    const running = store.runSchedule(task.id)!
    assert.equal(store.routineExecutionContext(task.id, running.id)?.blocked, undefined)
    store.setArtifactLifecycle(artifact.id, 'trashed', 0, tenant)
    assert.match(store.routineExecutionContext(task.id, running.id)?.blocked?.detail ?? '', /Trash/)
    const result = finish(running.id, 'Never publish into Trash.')
    assert.equal(result.status, 'failed')
    assert.match(result.detail ?? '', /Trash/)
    assert.equal(store.listTrashedArtifacts(tenant).filter((row) => row.artifact.sourceScheduleId === task.id).length, 1)
    assert.equal(store.listArtifacts(tenant).filter((row) => row.sourceScheduleId === task.id).length, 0)
    store.setArtifactLifecycle(artifact.id, 'active', 1, tenant)
    assert.deepEqual(store.artifactContent(tenant)[artifact.id], before)
    assert.equal(finish(store.runSchedule(task.id)!.id, 'A new explicitly run report.').status, 'ok')
    assert.equal(store.listArtifacts(tenant).filter((row) => row.sourceScheduleId === task.id).length, 1)
    assert.equal(store.artifactContent(tenant)[artifact.id]?.revision, (before?.revision ?? 0) + 1)
  } finally { store.removeSchedule(task.id) }
})

test('lifecycle retries acknowledge only the exact immediately represented step', () => {
  const artifact = create('trash-replay')
  const trashed = store.setArtifactLifecycle(artifact.id, 'trashed', 0, owner)
  assert.deepEqual(store.setArtifactLifecycle(artifact.id, 'trashed', 0, owner), trashed)
  assert.throws(() => store.setArtifactLifecycle(artifact.id, 'trashed', 1, owner), ConflictError)
  const restored = store.setArtifactLifecycle(artifact.id, 'active', 1, owner)
  assert.deepEqual(store.setArtifactLifecycle(artifact.id, 'active', 1, owner), restored)
  assert.throws(() => store.setArtifactLifecycle(artifact.id, 'trashed', 0, owner), ConflictError)
  store.setArtifactLifecycle(artifact.id, 'trashed', 2, owner)
  assert.throws(() => store.setArtifactLifecycle(artifact.id, 'active', 1, owner), ConflictError)
})

test('a saved-artifact proposal replay cannot change or resurrect its trashed row', () => {
  const op = { kind: 'save-artifact' as const, artifact: { name: 'Trash saved receipt.md', kind: 'doc' as const, meta: 'Document', body: 'Original saved bytes.' }, sessionTitle: 'Trash replay source' }
  store.applyRelationOp(op, owner)
  const artifact = store.listArtifacts(owner).find((item) => item.name === op.artifact.name)!
  const before = store.artifactContent(owner)[artifact.id]
  store.setArtifactLifecycle(artifact.id, 'trashed', 0, owner)
  store.applyRelationOp(op, owner)
  assert.equal(store.listArtifacts(owner).some((item) => item.id === artifact.id), false)
  assert.equal(store.listTrashedArtifacts(owner).filter((item) => item.artifact.id === artifact.id).length, 1)
  store.setArtifactLifecycle(artifact.id, 'active', 1, owner)
  assert.deepEqual(store.artifactContent(owner)[artifact.id], before)
  assert.equal(store.listArtifacts(owner).filter((item) => item.saveOrigin?.name === op.artifact.name).length, 1)
})

test('all Office exports recheck Trash after their serialization boundary', async () => {
  const cases = [
    { kind: 'doc', body: 'Exportable retained text.', export: (id: string) => store.exportArtifactWord(id, owner) },
    { kind: 'sheet', body: { type: 'sheet', columns: ['Value'], rows: [['Exact cell']] }, export: (id: string) => store.exportArtifactSpreadsheet(id, owner) },
    { kind: 'slide', body: { type: 'slides', slides: [{ title: 'Retained slide', bullets: ['Exact bullet'] }] }, export: (id: string) => store.exportArtifactPresentation(id, owner) },
  ] as const
  for (const [index, item] of cases.entries()) {
    const id = artifactCreationId(owner, `trash-office-${index}`)
    const created = store.createArtifact({ name: `Trash Office ${index}`, kind: item.kind, body: item.body }, owner, id)
    assert.ok(created && created !== 'invalid')
    const before = structuredClone(store.artifactContent(owner)[id])
    assert.ok(await item.export(id), `${item.kind}: genuinely exportable before Trash`)
    const pending = item.export(id)
    store.setArtifactLifecycle(id, 'trashed', 0, owner)
    assert.equal(await pending, undefined, `${item.kind}: serialization cannot outlive visibility`)
    assert.equal(await item.export(id), undefined)
    store.setArtifactLifecycle(id, 'active', 1, owner)
    assert.deepEqual(store.artifactContent(owner)[id], before)
    assert.ok(await item.export(id), `${item.kind}: exact retained bytes remain exportable after restore`)
  }
})
