import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from './index.ts'
import { authoredArtifact } from '../../contract/artifactAuthoring.ts'
import type { ScheduledTask } from '../../contract/index.ts'

const bodies = {
  sheet: { type: 'sheet', columns: ['Work', 'Status'], rows: [['=literal', 'Ready']] },
  slide: { type: 'slides', slides: [{ title: 'Release', bullets: ['Verified', 'Ready'] }] },
} as const

function taskSeed(): ScheduledTask {
  const { id: _id, ...seed } = structuredClone(store.listSchedules()[0]!)
  return store.addSchedule({ ...seed, tenantId: 'tenant-personal', name: 'Structured routine',
    runs: [], enabled: false, steps: [],
    delivery: { tool: { id: 'claude', label: 'Claude', tone: 'claude' }, target: 'Run conversation' } })
}

function approve(task: ScheduledTask, kind: 'doc' | 'sheet' | 'slide', name = 'Output') {
  store.applyRelationOp({ kind: 'set-schedule-artifact', scheduleId: task.id, scheduleName: task.name,
    cadence: task.cadence, artifactName: name, artifactKind: kind })
}

function finish(task: ScheduledTask, body?: unknown, runId = store.runSchedule(task.id)!.id) {
  return store.completeScheduleRun(task.id, runId, { id: 'reply', role: 'assistant', content: 'Run recap, not the artifact body.' },
    { agentId: 'test-agent', providerId: 'test-provider' }, Date.now(), body)!
}

for (const kind of ['sheet', 'slide'] as const) {
  test(`standing ${kind} output lands literal structured content and refreshes one identity`, () => {
    const task = taskSeed()
    try {
      approve(task, kind, 'Format is explicit.md')
      const body = structuredClone(bodies[kind])
      const firstRun = finish(task, body)
      assert.equal(firstRun.status, 'ok')
      const first = store.listArtifacts('tenant-personal').find((row) => row.sourceScheduleId === task.id)!
      assert.equal(first.kind, kind, 'filename suffix cannot choose the artifact format')
      const expected = authoredArtifact(first.name, kind, body)!
      assert.deepEqual(store.artifactContent('tenant-personal')[first.id], expected.body)
      assert.equal(first.excerpt, expected.excerpt)
      approve(task, kind, 'Renamed output')
      const next = finish(task, bodies[kind])
      assert.equal(next.status, 'ok')
      const rows = store.listArtifacts('tenant-personal').filter((row) => row.sourceScheduleId === task.id)
      assert.equal(rows.length, 1)
      assert.equal(rows[0]!.id, first.id)
      assert.equal(rows[0]!.name, 'Renamed output')
      assert.equal(store.artifactContent('tenant-personal')[first.id]?.revision, 1)
      assert.notEqual(rows[0]!.sourceSessionId, first.sourceSessionId)
    } finally { store.removeSchedule(task.id) }
  })

  test(`missing and malformed ${kind} candidates preserve the last good output`, () => {
    const task = taskSeed()
    try {
      approve(task, kind)
      finish(task, bodies[kind])
      const first = store.listArtifacts('tenant-personal').find((row) => row.sourceScheduleId === task.id)!
      const before = structuredClone(store.artifactContent('tenant-personal')[first.id])
      const events: string[] = []
      const unsubscribe = store.subscribe((event) => {
        if (event.type === 'artifact.changed' || event.type === 'relation.applied') events.push(event.type)
      })
      try {
        for (const bad of [undefined, 'JSON-looking prose', bodies[kind === 'sheet' ? 'slide' : 'sheet'],
          { ...bodies[kind], revision: 900 }]) {
          const run = finish(task, bad)
          assert.equal(run.status, 'failed')
          assert.equal(run.failureCode, 'execution_error')
          assert.match(run.detail!, /saved artifact was not changed/i)
          assert.deepEqual(store.artifactContent('tenant-personal')[first.id], before)
          assert.equal(store.listArtifacts('tenant-personal').find((row) => row.id === first.id)?.sourceSessionId, first.sourceSessionId)
        }
        assert.deepEqual(events, [], 'refused output never broadcasts artifact success')
      } finally { unsubscribe() }
    } finally { store.removeSchedule(task.id) }
  })
}

test('same-name format revocation fences both the attempt and structured publication', () => {
  const task = taskSeed()
  try {
    approve(task, 'sheet')
    const run = store.runSchedule(task.id)!
    approve(task, 'slide')
    assert.equal(store.routineExecutionContext(task.id, run.id)?.blocked?.code, 'authority_denied')
    assert.equal(finish(task, bodies.sheet, run.id).failureCode, 'authority_denied')
    assert.equal(store.listArtifacts('tenant-personal').some((row) => row.sourceScheduleId === task.id), false)
  } finally { store.removeSchedule(task.id) }
})

test('an already published output cannot silently change format', () => {
  const task = taskSeed()
  try {
    approve(task, 'doc')
    finish(task)
    const first = store.listArtifacts('tenant-personal').find((row) => row.sourceScheduleId === task.id)!
    const before = structuredClone(store.artifactContent('tenant-personal')[first.id])
    const graphBefore = structuredClone(store.relationGraph())
    assert.throws(() => approve(task, 'sheet'), /different format/i)
    assert.deepEqual(store.relationGraph(), graphBefore, 'refused format change leaves the standing grant intact')
    // Also fence inconsistent old snapshots or a format changed while model I/O
    // was running; final publication cannot rely only on proposal-time checks.
    const run = store.runSchedule(task.id)!
    store.relationGraph().extraArtifacts.find((row) => row.id === first.id)!.kind = 'sheet'
    assert.match(store.routineExecutionContext(task.id, run.id)?.blocked?.detail ?? '', /format/i)
    assert.equal(finish(task, undefined, run.id).failureCode, 'authority_denied')
    store.relationGraph().extraArtifacts.find((row) => row.id === first.id)!.kind = 'doc'
    assert.deepEqual(store.artifactContent('tenant-personal')[first.id], before)
    assert.equal(store.listArtifacts('tenant-personal').find((row) => row.id === first.id)?.kind, 'doc')
  } finally { store.removeSchedule(task.id) }
})

test('a later routine refresh cannot rewind the artifact timestamp when the wall clock moves backward', () => {
  const task = taskSeed()
  try {
    approve(task, 'sheet')
    const firstRun = store.runSchedule(task.id)!
    store.completeScheduleRun(task.id, firstRun.id, { id: 'first', role: 'assistant', content: 'First.' },
      { agentId: 'agent', providerId: 'provider' }, 20_000, bodies.sheet)
    const first = store.listArtifacts('tenant-personal').find((row) => row.sourceScheduleId === task.id)!
    const next = store.runSchedule(task.id)!
    store.completeScheduleRun(task.id, next.id, { id: 'next', role: 'assistant', content: 'Next.' },
      { agentId: 'agent', providerId: 'provider' }, 10_000, bodies.sheet)
    assert.equal(store.listArtifacts('tenant-personal').find((row) => row.id === first.id)!.editedAt, 20_000)
    assert.equal(store.artifactContent('tenant-personal')[first.id]?.revision, 1)
  } finally { store.removeSchedule(task.id) }
})
