import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from './index.ts'
import type { ScheduledTask, StepTool } from '../../contract/index.ts'

function taskSeed(): ScheduledTask {
  const { id: _id, ...seed } = structuredClone(store.listSchedules()[0]!)
  return store.addSchedule({
    ...seed, tenantId: 'tenant-personal', name: 'Frozen standing intent', runs: [], enabled: false,
    steps: [], delivery: { tool: { id: 'claude', label: 'Claude', tone: 'claude' }, target: 'Run conversation' },
  })
}

function approve(task: ScheduledTask, artifactName: string): void {
  store.applyRelationOp({ kind: 'set-schedule-artifact', scheduleId: task.id, scheduleName: task.name, cadence: task.cadence, artifactName })
}

function finish(task: ScheduledTask, runId: string, content = 'Generated report.') {
  return store.completeScheduleRun(task.id, runId, { id: 'model-result', role: 'assistant', content },
    { agentId: 'test-agent', providerId: 'test-provider' })!
}

test('a late artifact approval cannot adopt an already queued run', () => {
  const task = taskSeed()
  try {
    const run = store.runSchedule(task.id)!
    assert.deepEqual(run.execution?.standing, { artifact: null, tools: [] })
    approve(task, 'Next run only.md')
    assert.equal(finish(task, run.id).status, 'ok')
    assert.equal(store.listArtifacts('tenant-personal').some((artifact) => artifact.sourceScheduleId === task.id), false)
    const next = store.runSchedule(task.id)!
    assert.deepEqual(next.execution?.standing?.artifact, { name: 'Next run only.md', kind: 'doc' })
    assert.equal(finish(task, next.id).status, 'ok')
    assert.equal(store.listArtifacts('tenant-personal').filter((artifact) => artifact.sourceScheduleId === task.id).length, 1)
  } finally { store.removeSchedule(task.id) }
})

test('changing a queued delivery fails before model work and again before publication without replacing the last good artifact', () => {
  const task = taskSeed()
  try {
    approve(task, 'Original.md')
    finish(task, store.runSchedule(task.id)!.id, 'Keep this good report.')
    const artifact = store.listArtifacts('tenant-personal').find((row) => row.sourceScheduleId === task.id)!
    const before = structuredClone(store.artifactContent('tenant-personal')[artifact.id])
    const run = store.runSchedule(task.id)!
    assert.equal(store.routineExecutionContext(task.id, run.id)?.blocked, undefined)
    approve(task, 'Replacement.md')
    assert.deepEqual(run.execution?.standing?.artifact, { name: 'Original.md', kind: 'doc' })
    assert.equal(store.routineExecutionContext(task.id, run.id)?.blocked?.code, 'authority_denied')
    const events: string[] = []
    const unsubscribe = store.subscribe((event) => { if (event.type === 'artifact.changed' || event.type === 'relation.applied') events.push(event.type) })
    const result = finish(task, run.id, 'Do not publish this result.')
    unsubscribe()
    assert.equal(result.status, 'failed')
    assert.equal(result.failureCode, 'authority_denied')
    assert.match(result.detail!, /standing approvals changed/i)
    assert.deepEqual(events, [])
    assert.deepEqual(store.artifactContent('tenant-personal')[artifact.id], before)
    assert.equal(store.listArtifacts('tenant-personal').filter((row) => row.sourceScheduleId === task.id).length, 1)
  } finally { store.removeSchedule(task.id) }
})

test('legacy runs cannot infer a standing approval from the current graph', () => {
  const task = taskSeed()
  try {
    approve(task, 'Legacy.md')
    const run = store.runSchedule(task.id)!
    delete run.execution!.standing
    assert.equal(store.routineExecutionContext(task.id, run.id)?.blocked?.code, 'authority_denied')
    assert.equal(finish(task, run.id).status, 'failed')
    assert.equal(store.listArtifacts('tenant-personal').some((artifact) => artifact.sourceScheduleId === task.id), false)
  } finally { store.removeSchedule(task.id) }
})

test('extra tools are detached at queue time and late approvals do not enter the attempt', () => {
  const task = taskSeed()
  const tool: StepTool = { id: 'missing-context', label: 'Missing context', tone: 'connector' }
  try {
    const first = store.runSchedule(task.id)!
    store.applyRelationOp({ kind: 'schedule-add-tool', scheduleId: task.id, scheduleName: task.name, cadence: task.cadence, tool })
    assert.equal(store.routineExecutionContext(task.id, first.id)?.blocked, undefined, 'late tool does not become a dependency')
    finish(task, first.id)
    const next = store.runSchedule(task.id)!
    assert.deepEqual(next.execution?.standing?.tools, [tool])
    assert.equal(store.routineExecutionContext(task.id, next.id)?.blocked?.code, 'context_unavailable')
    tool.label = 'Changed after queuing'
    assert.equal(next.execution?.standing?.tools[0]?.label, 'Missing context', 'queued intent is detached from the graph')
    assert.equal(store.routineExecutionContext(task.id, next.id)?.blocked?.code, 'authority_denied', 'changed exact approval cannot authorize an old job')
    assert.equal(finish(task, next.id).failureCode, 'authority_denied')
  } finally { store.removeSchedule(task.id) }
})

test('a frozen extra-tool id cannot resolve to a different same-label connection', () => {
  const task = taskSeed()
  try {
    const connected = store.savedContexts('tenant-personal').contexts.find((context) => context.kind === 'connector' && context.status === 'connected')!
    assert.ok(connected, 'a connected fixture proves label fallback is reachable')
    const tool: StepTool = { id: 'retired-context-identity', label: connected.label, tone: 'connector' }
    store.applyRelationOp({ kind: 'schedule-add-tool', scheduleId: task.id, scheduleName: task.name, cadence: task.cadence, tool })
    const run = store.runSchedule(task.id)!
    const context = store.routineExecutionContext(task.id, run.id)!
    assert.equal(context.blocked?.code, 'context_unavailable')
    assert.equal(context.approvedContextIds.has(connected.id), false)
    assert.deepEqual(context.contexts, [])
  } finally { store.removeSchedule(task.id) }
})

test('invalid standing artifact names refuse approval before any new run or artifact', () => {
  const task = taskSeed()
  try {
    for (const name of ['', ' Report.md ', 'Bad\nname', 'x'.repeat(241)]) {
      assert.throws(() => approve(task, name), /valid name/)
      assert.equal(task.runs.length, 0)
      assert.equal(store.listArtifacts('tenant-personal').some((artifact) => artifact.sourceScheduleId === task.id), false)
    }
  } finally { store.removeSchedule(task.id) }
})

test('routine deletion removes standing graph state and detaches surviving artifact write authority', () => {
  const task = taskSeed()
  const other = taskSeed()
  try {
    approve(task, 'Keep the old report.md')
    finish(task, store.runSchedule(task.id)!.id, 'Surviving report.')
    const artifact = store.listArtifacts('tenant-personal').find((row) => row.sourceScheduleId === task.id)!
    const body = structuredClone(store.artifactContent('tenant-personal')[artifact.id])
    approve(task, 'Next report.md') // historical approval keys must also go
    approve(other, 'Other report.md')
    store.applyRelationOp({ kind: 'set-schedule-session', scheduleId: task.id, scheduleName: task.name, cadence: task.cadence, sessionLabel: 'Run here' })
    store.applyRelationOp({ kind: 'schedule-add-tool', scheduleId: task.id, scheduleName: task.name, cadence: task.cadence, tool: { id: 'slack', label: 'Slack', tone: 'connector' } })
    const before = store.relationGraph()
    const beforeRevision = before.revision ?? 0
    const otherKeys = Object.keys(before.standingApprovals).filter((key) => key.includes(`:${other.id}:`))
    assert.ok(otherKeys.length > 0)
    assert.equal(store.removeSchedule(task.id), true)
    const after = store.relationGraph()
    for (const map of [after.scheduleProject, after.scheduleArtifact, after.scheduleSession, after.scheduleExtraTools]) {
      assert.equal(Object.hasOwn(map, task.id), false)
    }
    assert.equal(Object.keys(after.standingApprovals).some((key) => key.includes(`:${task.id}:`) || key === `set-schedule-session:${task.id}`), false)
    for (const key of otherKeys) assert.equal(after.standingApprovals[key], true)
    assert.equal(after.revision, beforeRevision + 1, 'the entire cascade advances the graph once')
    const survivor = store.listArtifacts('tenant-personal').find((row) => row.id === artifact.id)!
    assert.ok(survivor)
    assert.equal(survivor.sourceScheduleId, undefined, 'deleted routine cannot retain overwrite authority')
    assert.equal(survivor.sourceSessionId, artifact.sourceSessionId, 'original run provenance survives')
    assert.equal(survivor.name, artifact.name)
    assert.deepEqual(store.artifactContent('tenant-personal')[artifact.id], body)
  } finally { store.removeSchedule(task.id); store.removeSchedule(other.id) }
})
