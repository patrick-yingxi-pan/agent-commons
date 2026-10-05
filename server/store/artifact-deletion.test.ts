import assert from 'node:assert/strict'
import { test } from 'node:test'
import { store } from './index.ts'
import { artifactCreationId } from '../artifactCreationIdentity.ts'
import type { ScheduledTask } from '../../contract/index.ts'

const owner = 'tenant-artifact-deletion-store-owner'

function deleteReviewed(id: string) {
  store.setArtifactLifecycle(id, 'trashed', store.getArtifactLifecycle(id, owner)!.lifecycle.revision, owner)
  const preview = store.previewArtifactDeletion(id, owner)!
  return store.permanentlyDeleteArtifact(id, {
    expectedLifecycleRevision: preview.lifecycleRevision,
    reviewToken: preview.reviewToken,
  }, owner, 'user-artifact-deletion-owner', `store-delete-${id}`)
}

function taskSeed(): Omit<ScheduledTask, 'id'> {
  const source = store.listSchedules().find((task) => task.steps.length > 0) ?? store.listSchedules()[0]
  assert.ok(source)
  const { id: _id, runs: _runs, ...rest } = structuredClone(source)
  return { ...rest, runs: [], tenantId: owner, enabled: false }
}

test('retirement blocks saved-origin replay and deterministic keyed recreation', () => {
  const stamp = Date.now()
  const op = {
    kind: 'save-artifact' as const,
    artifact: { name: `Retired origin ${stamp}.md`, kind: 'doc' as const, meta: 'Saved', body: 'Original saved body.' },
    sessionTitle: `Source ${stamp}`,
    sessionId: `source-session-${stamp}`,
  }
  store.applyRelationOp(op, owner)
  const artifact = store.listArtifacts(owner).find((row) => row.saveOrigin?.name === op.artifact.name && row.tenantId === owner)!
  assert.ok(artifact)
  assert.deepEqual(deleteReviewed(artifact.id), { artifactId: artifact.id, deleted: true })
  assert.throws(() => store.applyRelationOp(op, owner), /permanently deleted/)

  const id = artifactCreationId(owner, `keyed-${stamp}`)
  const name = `Keyed ${stamp}.md`
  const created = store.createArtifact({ name, kind: 'doc', body: 'Keyed body.' }, owner, id)
  assert.ok(created && created !== 'invalid')
  assert.deepEqual(deleteReviewed(id), { artifactId: id, deleted: true })
  assert.equal(store.getArtifactCreation(id, owner), 'invalid')
  assert.equal(store.createArtifact({ name, kind: 'doc', body: 'Replacement.' }, owner, id), 'invalid')
  const distinctSave = {
    kind: 'save-artifact' as const,
    artifact: { name, kind: 'doc' as const, meta: 'Document', body: 'A distinct conversational save.' },
    sessionTitle: 'Created here',
  }
  store.applyRelationOp(distinctSave, owner)
  const saved = store.listArtifacts(owner).find((row) => row.saveOrigin?.name === name && row.tenantId === owner)
  assert.ok(saved && saved.id !== id,
    'deleting a direct creation must not retire its synthetic saveOrigin as a distinct conversational identity')
})

test('permanently deleting a routine output retires the standing output binding', () => {
  const task = store.addSchedule({ ...taskSeed(), name: `Retired routine ${Date.now()}`, tenantId: owner, enabled: false })
  const name = `routine-deleted-${task.id}.md`
  store.applyRelationOp({
    kind: 'set-schedule-artifact', scheduleId: task.id, scheduleName: task.name,
    cadence: task.cadence, artifactName: name,
  }, owner)
  const run = store.runSchedule(task.id)!
  const context = store.routineExecutionContext(task.id, run.id)!
  store.markScheduleRunAttempt(task.id, run.id, 1, run.at + 100)
  store.completeScheduleRun(
    task.id,
    run.id,
    { id: `model-${run.id}`, role: 'assistant', content: 'Routine output to retire.' },
    { agentId: context.agent.id, providerId: context.provider.id, ...(context.modelId ? { modelId: context.modelId } : {}) },
    run.at + 1000,
  )
  const output = store.listArtifacts(owner).find((artifact) => artifact.sourceScheduleId === task.id)!
  assert.ok(output)
  deleteReviewed(output.id)
  assert.throws(() => store.applyRelationOp({
    kind: 'set-schedule-artifact', scheduleId: task.id, scheduleName: task.name,
    cadence: task.cadence, artifactName: name,
  }, owner), /permanently deleted/)
  assert.equal(store.listArtifacts(owner).some((artifact) => artifact.sourceScheduleId === task.id), false)
  const retry = store.runSchedule(task.id)!
  const blocked = store.routineExecutionContext(task.id, retry.id)
  assert.equal(blocked?.blocked?.code, 'authority_denied', 'the retained binding cannot silently mint a replacement output')
  assert.equal(store.listArtifacts(owner).some((artifact) => artifact.sourceScheduleId === task.id), false)
  store.removeSchedule(task.id)
})
