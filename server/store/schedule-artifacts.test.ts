/** Scheduled artifact output is a durable document, not only a relation row. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from './index.ts'
import { runSessionId } from '../../contract/ids.ts'
import { authoredDocument } from '../../contract/index.ts'
import type { ArtifactItem, ScheduledTask } from '../../contract/index.ts'

function taskSeed(): Omit<ScheduledTask, 'id'> {
  const source = store.listSchedules().find((task) => task.steps.length > 0) ?? store.listSchedules()[0]
  assert.ok(source, 'a routine seed is available')
  const { id: _id, runs: _runs, tenantId: _tenantId, ...rest } = structuredClone(source)
  return { ...rest, runs: [], enabled: false }
}

function addTask(name: string): ScheduledTask {
  return store.addSchedule({ ...taskSeed(), name, tenantId: 'tenant-personal', runs: [], enabled: false })
}

function contentFor(task: ScheduledTask) {
  return store.artifactContent(task.tenantId ?? 'tenant-personal')
}

function approve(task: ScheduledTask, artifactName: string): void {
  store.applyRelationOp({
    kind: 'set-schedule-artifact',
    scheduleId: task.id,
    scheduleName: task.name,
    cadence: task.cadence,
    artifactName,
  })
}

function complete(task: ScheduledTask, content: string) {
  const run = store.runSchedule(task.id)!
  const context = store.routineExecutionContext(task.id, run.id)!
  store.markScheduleRunAttempt(task.id, run.id, 1, run.at + 100)
  store.completeScheduleRun(
    task.id,
    run.id,
    { id: `model-${run.id}`, role: 'assistant', content },
    { agentId: context.agent.id, providerId: context.provider.id, ...(context.modelId ? { modelId: context.modelId } : {}) },
    run.at + 1_000,
  )
  return { run, sessionId: runSessionId(task.id, run.id) }
}

function authoredArtifacts(name: string): ArtifactItem[] {
  return store.relationGraph().extraArtifacts.filter((artifact) => artifact.name === name)
}

test('an approved routine stores the successful model output as an id-bound authored document', () => {
  const task = addTask(`artifact output ${Date.now().toString(36)}`)
  const name = `routine-output-${task.id}.md`
  approve(task, name)
  const { run, sessionId } = complete(task, 'A useful digest from the model.')

  const artifact = authoredArtifacts(name).find((row) => row.sourceScheduleId === task.id)
  assert.ok(artifact, 'the standing artifact carries its stable routine binding')
  assert.equal(artifact!.sourceSessionId, sessionId, 'the artifact points at the latest successful run')
  assert.equal(artifact!.tenantId, 'tenant-personal', 'the artifact is stamped to the routine owner')
  assert.equal(artifact!.meta, `Saved by ${task.name}`)
  assert.equal(artifact!.excerpt, 'A useful digest from the model.')
  assert.deepEqual(contentFor(task)[artifact!.id], authoredDocument(name, 'A useful digest from the model.')!.body)
  assert.equal(run.status, 'ok')
  store.removeSchedule(task.id)
})

test('repeated runs refresh one artifact, advance body revision, and reject stale edits', () => {
  const task = addTask(`artifact revision ${Date.now().toString(36)}`)
  const name = `revision-output-${task.id}.md`
  approve(task, name)
  complete(task, 'First digest.')
  const first = authoredArtifacts(name).find((row) => row.sourceScheduleId === task.id)!
  const firstBody = contentFor(task)[first.id] as { revision: number }
  const edited = store.updateArtifactBlock(first.id, 0, 'A reviewed edit.', firstBody.revision)
  assert.ok(edited, 'the ordinary artifact editor can create a newer body revision')

  const secondRun = complete(task, 'Second digest, replacing the prior run.')
  const rows = authoredArtifacts(name).filter((row) => row.sourceScheduleId === task.id)
  assert.equal(rows.length, 1, 'a routine owns one bounded artifact')
  const second = rows[0]
  const secondBody = contentFor(task)[second.id] as { revision: number; blocks: Array<{ p?: string }> }
  assert.equal(second.sourceSessionId, secondRun.sessionId)
  assert.equal(second.excerpt, 'Second digest, replacing the prior run.')
  assert.equal(secondBody.revision, (edited as { revision: number }).revision + 1)
  assert.equal(secondBody.blocks[0]?.p, 'Second digest, replacing the prior run.')
  assert.throws(() => store.updateArtifactBlock(second.id, 0, 'stale', firstBody.revision), /changed elsewhere/)
  store.removeSchedule(task.id)
})

test('renaming a routine preserves its delivered identity, filing, and grants', () => {
  const task = addTask(`rename artifact ${Date.now().toString(36)}`)
  const name = `rename-output-${task.id}.md`
  approve(task, name)
  complete(task, 'Before the rename.')
  const first = authoredArtifacts(name).find((row) => row.sourceScheduleId === task.id)!
  store.applyRelationOp({
    kind: 'refile-artifact',
    artifactId: first.id,
    artifactName: name,
    projectId: 'p-insights',
    projectName: 'Insights dashboard',
  })
  const grant = store.createGrant({
    subject: { kind: 'artifact', id: first.id },
    audience: { kind: 'principal', principalId: 'tenant-beta' },
    tier: 'view',
  }, 'tenant-personal')
  assert.equal(typeof grant, 'object')
  store.updateSchedule(task.id, { name: `${task.name} renamed` })
  complete(task, 'After the rename.')
  const second = authoredArtifacts(name).find((row) => row.sourceScheduleId === task.id)!
  const projected = store.listArtifacts('tenant-personal').find((row) => row.id === first.id)!
  assert.equal(second.id, first.id)
  assert.equal(projected.projectId, 'p-insights', 'the user filing survives a standing refresh')
  assert.equal(second.sourceSessionId !== first.sourceSessionId, true)
  assert.equal(store.listGrants({ kind: 'artifact', id: first.id }, 'tenant-personal').length, 1, 'the owner grant survives')
  store.removeSchedule(task.id)
})

test('routine identity prevents ordinary and same-name artifacts from being overwritten', () => {
  const taskA = addTask(`same routine ${Date.now().toString(36)}`)
  const taskB = store.addSchedule({ ...taskSeed(), name: taskA.name, runs: [], enabled: false })
  const name = `same-name-${taskA.id}.md`
  const source = `Scheduled run of ${taskA.name}`
  store.applyRelationOp({
    kind: 'save-artifact',
    artifact: { name, kind: 'doc', meta: 'Ordinary', body: 'Ordinary document.' },
    sessionTitle: source,
    sessionId: 'ordinary-source',
  })
  const ordinary = authoredArtifacts(name).find((row) => row.sourceSessionId === 'ordinary-source')!
  approve(taskA, name)
  approve(taskB, name)
  complete(taskA, 'Routine A output.')
  complete(taskB, 'Routine B output.')
  const rows = authoredArtifacts(name)
  assert.equal(rows.find((row) => row.id === ordinary.id)?.excerpt, 'Ordinary document.')
  assert.equal(rows.filter((row) => row.sourceScheduleId === taskA.id).length, 1)
  assert.equal(rows.filter((row) => row.sourceScheduleId === taskB.id).length, 1)
  store.removeSchedule(taskA.id)
  store.removeSchedule(taskB.id)
})

test('foreign same-name artifacts and owner-private body events remain isolated', () => {
  const task = addTask(`private artifact ${Date.now().toString(36)}`)
  const name = `private-output-${task.id}.md`
  const source = `Scheduled run of ${task.name}`
  store.applyRelationOp({
    kind: 'save-artifact',
    artifact: { name, kind: 'doc', meta: 'Foreign', body: 'Foreign document.' },
    sessionTitle: source,
    sessionId: 'foreign-source',
  }, 'tenant-foreign-artifact')
  const foreign = store.relationGraph('tenant-foreign-artifact').extraArtifacts.find((row) => row.name === name)!
  approve(task, name)
  complete(task, 'Owner output.')
  const owner = authoredArtifacts(name).find((row) => row.sourceScheduleId === task.id)!
  assert.notEqual(owner.id, foreign.id)
  assert.equal(store.artifactContent('tenant-foreign-artifact')[foreign.id]?.type, 'doc')
  const event = { type: 'artifact.changed', artifactId: owner.id } as const
  assert.equal(store.eventVisibleToTenant(event, 'tenant-personal'), true)
  assert.equal(store.eventVisibleToTenant(event, 'tenant-foreign-artifact'), false)
  store.removeSchedule(task.id)
})

test('empty successful output fails the run and preserves the last authored body', () => {
  const task = addTask(`empty artifact ${Date.now().toString(36)}`)
  const name = `empty-output-${task.id}.md`
  approve(task, name)
  complete(task, 'Last good digest.')
  const before = authoredArtifacts(name).find((row) => row.sourceScheduleId === task.id)!
  const beforeBody = structuredClone(contentFor(task)[before.id])
  const run = store.runSchedule(task.id)!
  const context = store.routineExecutionContext(task.id, run.id)!
  store.markScheduleRunAttempt(task.id, run.id, 1, run.at + 100)
  store.completeScheduleRun(
    task.id,
    run.id,
    { id: `empty-${run.id}`, role: 'assistant', content: '   ' },
    { agentId: context.agent.id, providerId: context.provider.id },
    run.at + 1_000,
  )
  assert.equal(run.status, 'failed')
  assert.equal(run.failureCode, 'execution_error')
  assert.deepEqual(contentFor(task)[before.id], beforeBody)
  store.removeSchedule(task.id)
})

test('an explicit terminal failure after a prior success leaves the last artifact body untouched', () => {
  const task = addTask(`failed artifact ${Date.now().toString(36)}`)
  const name = `failed-output-${task.id}.md`
  approve(task, name)
  complete(task, 'Last successful digest.')
  const artifact = authoredArtifacts(name).find((row) => row.sourceScheduleId === task.id)!
  const before = structuredClone(contentFor(task)[artifact.id])
  const run = store.runSchedule(task.id)!
  store.markScheduleRunAttempt(task.id, run.id, 1, run.at + 100)
  store.failScheduleRun(task.id, run.id, 'execution_error', 'The endpoint stopped.', run.at + 1_000)
  assert.equal(run.status, 'failed')
  assert.deepEqual(contentFor(task)[artifact.id], before)
  store.removeSchedule(task.id)
})

test('without standing approval a successful run produces no delivered artifact', () => {
  const task = addTask(`unapproved artifact ${Date.now().toString(36)}`)
  const name = `unapproved-output-${task.id}.md`
  complete(task, 'A run result without approval.')
  assert.equal(authoredArtifacts(name).length, 0)
  store.removeSchedule(task.id)
})

test('only an exact metadata-only legacy run artifact is adopted; authored lookalikes are not', () => {
  const task = addTask(`legacy artifact ${Date.now().toString(36)}`)
  const name = `legacy-output-${task.id}.md`
  approve(task, name)
  const run = store.runSchedule(task.id)!
  const runSource = `Scheduled run of ${task.name}`
  const runSession = runSessionId(task.id, run.id)
  store.applyRelationOp({
    kind: 'save-artifact',
    artifact: { name, kind: 'doc', meta: 'Legacy metadata' },
    sessionId: runSession,
    sessionTitle: runSource,
  })
  const legacy = authoredArtifacts(name).find((row) => row.sourceSessionId === runSession)!
  store.completeScheduleRun(
    task.id,
    run.id,
    { id: `legacy-${run.id}`, role: 'assistant', content: 'Adopt this exact legacy row.' },
    { agentId: 'agent-default', providerId: 'provider-anthropic' },
    run.at + 1_000,
  )
  const adopted = authoredArtifacts(name).filter((row) => row.sourceScheduleId === task.id)
  assert.equal(adopted.length, 1)
  assert.equal(adopted[0].id, legacy.id)

  const other = addTask(`legacy authored ${Date.now().toString(36)}`)
  const otherName = `legacy-authored-${other.id}.md`
  approve(other, otherName)
  const otherRun = store.runSchedule(other.id)!
  const otherSource = `Scheduled run of ${other.name}`
  const otherSession = runSessionId(other.id, otherRun.id)
  store.applyRelationOp({
    kind: 'save-artifact',
    artifact: { name: otherName, kind: 'doc', meta: 'Already authored', body: 'Do not adopt this.' },
    sessionId: otherSession,
    sessionTitle: otherSource,
  })
  const authored = authoredArtifacts(otherName).find((row) => row.sourceSessionId === otherSession)!
  store.completeScheduleRun(
    other.id,
    otherRun.id,
    { id: `authored-${otherRun.id}`, role: 'assistant', content: 'Create a separate routine artifact.' },
    { agentId: 'agent-default', providerId: 'provider-anthropic' },
    otherRun.at + 1_000,
  )
  const outputRows = authoredArtifacts(otherName).filter((row) => row.sourceScheduleId === other.id)
  assert.equal(outputRows.length, 1)
  assert.notEqual(outputRows[0].id, authored.id)
  store.removeSchedule(task.id)
  store.removeSchedule(other.id)
})

test('a terminal duplicate run cannot rewrite its delivered artifact', () => {
  const task = addTask(`terminal artifact ${Date.now().toString(36)}`)
  const name = `terminal-output-${task.id}.md`
  approve(task, name)
  const { run } = complete(task, 'Terminal digest.')
  const artifact = authoredArtifacts(name).find((row) => row.sourceScheduleId === task.id)!
  const before = structuredClone(contentFor(task)[artifact.id])
  store.completeScheduleRun(task.id, run.id, { id: 'late', role: 'assistant', content: 'Late rewrite.' }, { agentId: 'agent-default', providerId: 'provider-anthropic' })
  assert.deepEqual(contentFor(task)[artifact.id], before)
  store.removeSchedule(task.id)
})
