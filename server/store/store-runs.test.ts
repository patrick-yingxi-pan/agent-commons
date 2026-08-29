/** Durable scheduled-run state through the real store. Model I/O belongs to the
 *  routine worker; these tests drive the worker-facing transition methods and
 *  assert their persisted/event effects without dialing an endpoint. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from './index.ts'
import { runSessionId } from '../../contract/ids.ts'

/** A routine with >= 2 steps, fewest first, so the stepped wait stays short while
 *  still exercising more than one progress emit. */
function steppedTask() {
  const tasks = store.listSchedules()
  const withSteps = tasks.filter((t) => t.steps.length >= 2).sort((a, b) => a.steps.length - b.steps.length)
  return withSteps[0] ?? tasks.reduce((a, b) => (b.steps.length < a.steps.length ? b : a))
}

function complete(taskId: string, runId: string, content = 'A real routine result.'): void {
  const ctx = store.routineExecutionContext(taskId, runId)!
  store.markScheduleRunAttempt(taskId, runId, 1, ctx.run.at + 100)
  store.completeScheduleRun(
    taskId,
    runId,
    { id: `m-${runId}`, role: 'assistant', content },
    { agentId: ctx.agent.id, providerId: ctx.provider.id, ...(ctx.modelId ? { modelId: ctx.modelId } : {}) },
    ctx.run.at + 1_100,
  )
}

test('runSchedule persists a queued attempt, then the worker transition finishes it with model output', () => {
  const task = steppedTask()
  const steps = task.steps.length
  const events: string[] = []
  const unsub = store.subscribe((event) => {
    if ('taskId' in event && event.taskId === task.id) events.push(event.type)
  })

  const run = store.runSchedule(task.id)!
  assert.equal(run?.status, 'running', 'a run mints as running')
  assert.ok(Number.isFinite(run?.at), 'a live run carries a real epoch-ms `at`, not 0/undefined')
  assert.equal(run.attempts, 0)
  assert.equal(run.maxAttempts, 3)
  assert.equal(run.nextAttemptAt, run.at)
  complete(task.id, run.id, 'Delivered model-authored briefing.')
  unsub()

  assert.equal(run.status, 'ok')
  assert.equal(run.reachedStep, steps, 'completion lights the authored workflow')
  assert.equal(run.detail, 'Delivered model-authored briefing.')
  const session = store.getSession(runSessionId(task.id, run.id))!
  assert.equal(session.messages?.filter((message) => message.id === 'm2').length, 1,
    'the actual model result owns the run session’s restart-idempotent primary-result key')
  assert.equal(session.messages?.find((message) => message.id === 'm2')?.content, 'Delivered model-authored briefing.')
  assert.deepEqual(events, ['run.started', 'run.progress', 'run.finished'])
})

test('routine resolution accepts a configured model on a catalog-less endpoint', () => {
  const provider = store.createProvider(
    { label: 'Catalog-less endpoint', modelFamily: 'claude', effortLevels: [] },
    { model: 'configured-private-model' },
  )
  const agent = store.createAgent({
    label: 'Catalog-less endpoint Agent',
    systemPrompt: 'Run the routine.',
    tools: [],
    instructions: '',
    providerId: provider.id,
  })
  const source = steppedTask()
  const { id: _id, tenantId: _tenant, modelId: _modelId, effort: _effort, ...seed } = structuredClone(source)
  const task = store.addSchedule({
    ...seed,
    name: 'Catalog-less endpoint routine',
    agentId: agent.id,
    providerId: provider.id,
    runs: [],
    enabled: false,
    steps: [],
    delivery: { tool: { id: 'claude', label: 'Claude', tone: 'claude' }, target: 'Run conversation' },
  })
  const run = store.runSchedule(task.id)!
  const queuedPrompt = task.prompt
  store.updateSchedule(task.id, { prompt: 'A later definition for the next run.' })
  const ctx = store.routineExecutionContext(task.id, run.id)!
  assert.equal(ctx.blocked, undefined, 'absence of a catalog means unknown, not no executable models')
  assert.equal(ctx.modelId, 'configured-private-model')
  assert.equal(ctx.task.prompt, queuedPrompt, 'an in-flight retry keeps the definition revision queued with its run')
  assert.equal(run.execution?.definitionRevision, 0)
  const session = store.getSession(runSessionId(task.id, run.id))!
  assert.equal(session.agentId, agent.id, 'the run conversation keeps the unattended Agent for follow-up turns')
  assert.equal(session.providerId, provider.id, 'the run conversation keeps the unattended endpoint binding')

  store.failScheduleRun(task.id, run.id, 'execution_error', 'Test cleanup.')
  store.removeSchedule(task.id)
  assert.equal(store.deleteAgent(agent.id), true)
  assert.equal(store.deleteProvider(provider.id), true)
})

test('routine resolution fails closed when an authored connector is not connected', () => {
  const source = steppedTask()
  const { id: _id, tenantId: _tenant, ...seed } = structuredClone(source)
  const task = store.addSchedule({
    ...seed,
    name: 'Missing context routine',
    runs: [],
    enabled: false,
    steps: [{ id: 'missing-step', action: 'Read it', tool: { id: 'missing-context', label: 'Missing context', tone: 'connector' } }],
    delivery: { tool: { id: 'claude', label: 'Claude', tone: 'claude' }, target: 'Run conversation' },
  })
  const run = store.runSchedule(task.id)!
  assert.deepEqual(store.routineExecutionContext(task.id, run.id)?.blocked, {
    code: 'context_unavailable',
    detail: 'Connect Missing context before this routine can run.',
  })
  store.failScheduleRun(task.id, run.id, 'context_unavailable', 'Test cleanup.')
  store.removeSchedule(task.id)
})

// Run the routine once and resolve when its run finishes, capturing whether a
// standing relation.applied fired during the run.
function runOnce(taskId: string) {
  let standingOp
  const unsub = store.subscribe((e) => {
    if (e.type === 'relation.applied' && e.by === 'standing') standingOp = e.op
  })
  const run = store.runSchedule(taskId)!
  complete(taskId, run.id)
  unsub()
  return standingOp
}

test('a standing "save artifact each run" approval saves an artifact unprompted (relation.applied by standing)', () => {
  const task = steppedTask()
  const standingName = 'Standing digest'
  const standingSource = `Scheduled run of ${task.name}`
  // A foreign tenant may use the same human name + source without capturing or
  // being refreshed by the desktop/default tenant's standing approval.
  store.applyRelationOp(
    {
      kind: 'save-artifact',
      artifact: { name: standingName, kind: 'doc', meta: 'Foreign tenant copy' },
      sessionTitle: standingSource,
    },
    'tenant-foreign-standing',
  )
  const foreignBefore = store
    .relationGraph('tenant-foreign-standing')
    .extraArtifacts.find((artifact) => artifact.name === standingName && artifact.source === standingSource)
  assert.ok(foreignBefore, 'the cross-tenant collision fixture exists')
  // Approve once, in advance: this routine saves an artifact every run.
  store.applyRelationOp({
    kind: 'set-schedule-artifact',
    scheduleId: task.id,
    scheduleName: task.name,
    cadence: task.cadence,
    artifactName: standingName,
  })
  const before = store.relationGraph().extraArtifacts.length

  const op1 = runOnce(task.id)
  assert.ok(op1, 'a relation.applied by:standing fired on the run')
  assert.equal(op1.kind, 'save-artifact', 'the standing effect is the artifact save')
  assert.equal(op1.ownerTenantId, 'tenant-personal', 'the server stamps the standing effect owner')
  assert.equal(
    store.relationGraph().extraArtifacts.length,
    before + 1,
    'the first run mints the routine’s one delivered artifact — no confirmation card',
  )
  const foreignAfter = store
    .relationGraph('tenant-foreign-standing')
    .extraArtifacts.find((artifact) => artifact.id === foreignBefore.id)
  assert.equal(foreignAfter?.editedAt, foreignBefore.editedAt, 'the same-name foreign artifact was not refreshed')
})

test('a second standing run refreshes the same artifact, not appends one (bounded growth)', () => {
  const task = steppedTask()
  const before = store.relationGraph().extraArtifacts.length

  const op2 = runOnce(task.id)
  assert.ok(op2, 'the standing effect still fires on the second run')
  assert.equal(
    store.relationGraph().extraArtifacts.length,
    before,
    'the routine owns ONE live artifact, refreshed in place — the daemon cannot grow the store unbounded',
  )
})

test('a routine with no standing approval applies no standing effect on a run', () => {
  const graph = store.relationGraph()
  const task = store
    .listSchedules()
    .filter((t) => !graph.scheduleArtifact[t.id])
    .reduce((a, b) => (b.steps.length < a.steps.length ? b : a))

  let sawStanding = false
  const unsub = store.subscribe((e) => {
    if (e.type === 'relation.applied' && e.by === 'standing') sawStanding = true
  })

  const run = store.runSchedule(task.id)!
  complete(task.id, run.id)
  unsub()

  assert.equal(sawStanding, false, 'no standing graph edit without a prior approval')
})

test('a terminal failure persists its typed cause, recap, and exact-run notification', () => {
  const source = store.listSchedules()[0]
  const { id: _id, tenantId: _tenant, ...seed } = structuredClone(source)
  const task = store.addSchedule({
    ...seed,
    name: 'Failure notification routine',
    runs: [],
    enabled: false,
    notifyOnFailure: true,
  })
  const before = store.listNotifications(store.defaultTenantId()).length
  const run = store.runSchedule(task.id)!
  store.markScheduleRunAttempt(task.id, run.id, 1, run.at + 100)
  store.failScheduleRun(task.id, run.id, 'context_unavailable', 'Connect Linear before this routine can run.', run.at + 500)

  assert.equal(run.status, 'failed')
  assert.equal(run.failureCode, 'context_unavailable')
  assert.equal(run.detail, 'Connect Linear before this routine can run.')
  const session = store.getSession(runSessionId(task.id, run.id))!
  assert.ok(session.messages?.some((message) => message.role === 'assistant' && /Connect Linear/.test(message.content)))
  const notifications = store.listNotifications(store.defaultTenantId())
  assert.equal(notifications.length, before + 1)
  assert.deepEqual(
    { kind: notifications[0].kind, scheduleId: notifications[0].scheduleId, runId: notifications[0].runId },
    { kind: 'schedule.failed', scheduleId: task.id, runId: run.id },
  )

  const silent = store.addSchedule({
    ...seed,
    name: 'Silent failure routine',
    runs: [],
    enabled: false,
    notifyOnFailure: false,
  })
  const silentRun = store.runSchedule(silent.id)!
  store.markScheduleRunAttempt(silent.id, silentRun.id, 1, silentRun.at + 100)
  store.failScheduleRun(silent.id, silentRun.id, 'model_unavailable', 'The endpoint is offline.', silentRun.at + 500)
  assert.equal(
    store.listNotifications(store.defaultTenantId()).length,
    notifications.length,
    'notifyOnFailure=false produces no inbox alert',
  )
  store.removeSchedule(task.id)
  store.removeSchedule(silent.id)
})
