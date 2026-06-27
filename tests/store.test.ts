/** Regression baseline for the store spine the broker work touches — capabilities,
 *  sessions, usage, the event bus, recents — plus the new registry seed. Guards
 *  against breaking existing behavior while the architecture grows. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from '../server/store.ts'

test('capabilities: the mock backend reports its native features true', () => {
  const caps = store.capabilities()
  assert.equal(caps.backend, 'mock')
  assert.equal(caps.features.localFs, true)
  assert.equal(caps.features.streaming, true)
  assert.equal(typeof caps.epoch, 'string')
})

test('sessions: the list is non-empty and the demo session resolves', () => {
  const sessions = store.listSessions()
  assert.ok(Array.isArray(sessions))
  assert.ok(sessions.length > 0)
  assert.ok(store.getSession(store.demoSessionId))
})

test('usage: the snapshot has the gauge shape', () => {
  const u = store.usage()
  assert.ok(u.context)
  assert.ok(Array.isArray(u.limits))
})

test('event bus: a subscriber receives emits; unsubscribe stops them', () => {
  const got: string[] = []
  const off = store.subscribe((e) => got.push(e.type))
  store.emit({ type: 'hello', epoch: 'x' })
  off()
  store.emit({ type: 'hello', epoch: 'y' })
  assert.deepEqual(got, ['hello'])
})

test('pushRecent prepends and broadcasts recents.changed', () => {
  const got: Array<{ ids: string[] }> = []
  const off = store.subscribe((e) => {
    if (e.type === 'recents.changed') got.push(e)
  })
  const snap = store.pushRecent('repo', 'repo-zzz')
  off()
  assert.equal(snap.repo[0], 'repo-zzz')
  assert.equal(got.length, 1)
  assert.equal(got[0].ids[0], 'repo-zzz')
})

test('registry: native mode seeds the co-located runner with fs/terminal/process', () => {
  const ids = store.registry.list().map((a) => a.id)
  assert.ok(ids.includes('runner-local'))
  const local = store.registry.get('runner-local')
  assert.ok(local)
  assert.equal(local.status, 'online')
  assert.ok(local.capabilities.some((c) => c.type === 'fs.read'))
  assert.ok(local.capabilities.some((c) => c.type === 'terminal'))
})

test('relations: the graph seeds a project’s scoped contexts from its seed data', () => {
  const project = store.listProjects()[0]
  const seeded = store.relationGraph().projectContexts[project.id]
  assert.ok(Array.isArray(seeded) && seeded.length > 0, 'a seed project carries its scoped contexts in the graph')
})

test('updateSchedule merges a partial field patch, leaving id / runs / unspecified fields intact', () => {
  const task = store.listSchedules()[0]
  const before = { prompt: task.prompt, cadence: task.cadence, model: task.model, runs: task.runs.length }

  const updated = store.updateSchedule(task.id, { name: 'Renamed', notifyOnFailure: false })
  assert.ok(updated)
  assert.equal(updated.name, 'Renamed', 'name patched')
  assert.equal(updated.notifyOnFailure, false, 'notifyOnFailure persisted (a real routine field now)')
  assert.equal(updated.prompt, before.prompt, 'unspecified prompt untouched')
  assert.equal(updated.cadence, before.cadence, 'unspecified cadence untouched')
  assert.equal(updated.model, before.model, 'unspecified model untouched')
  assert.equal(updated.id, task.id, 'id is never overwritten')
  assert.equal(updated.runs.length, before.runs, 'run history is untouched by a field patch')
  assert.equal(store.listSchedules()[0].name, 'Renamed', 'the change is live on the canonical list')
})

test('updateSchedule returns undefined for an unknown routine id (the 404 path)', () => {
  assert.equal(store.updateSchedule('s-does-not-exist', { name: 'x' }), undefined)
})

test('updateSchedule replaces the delivery and steps when those fields are patched', () => {
  const task = store.listSchedules()[0]
  const delivery = { tool: { id: 'slack', label: 'Slack', tone: 'connector' as const }, target: '#new-channel' }
  const steps = [{ id: 'sx', action: 'A single new step', tool: { id: 'claude', label: 'Claude', tone: 'claude' as const } }]
  const updated = store.updateSchedule(task.id, { delivery, steps })
  assert.ok(updated)
  assert.deepEqual(updated.delivery, delivery, 'delivery replaced wholesale')
  assert.equal(updated.steps.length, 1, 'steps replaced wholesale')
  assert.equal(updated.steps[0].action, 'A single new step')
  assert.equal(updated.runs.length, task.runs.length, 'run history is still untouched')
})

test('relations: the project-detail ops mutate the canonical graph + broadcast relation.applied', () => {
  const project = store.listProjects()[0]
  const seedLabel = store.relationGraph().projectContexts[project.id][0].label

  const ops: string[] = []
  const off = store.subscribe((e) => {
    if (e.type === 'relation.applied') ops.push(e.op.kind)
  })

  // Scope a fresh context, then unscope the seeded one — both reflect in the graph.
  store.applyRelationOp({
    kind: 'scope-context',
    projectId: project.id,
    projectName: project.name,
    context: { kind: 'connector', label: 'Test connector', meta: 'added by a test' },
  })
  store.applyRelationOp({
    kind: 'unscope-context',
    projectId: project.id,
    projectName: project.name,
    contextLabel: seedLabel,
  })
  // Edit the instructions — overlaid in the new graph slice.
  store.applyRelationOp({
    kind: 'set-project-instructions',
    projectId: project.id,
    projectName: project.name,
    instructions: 'Lead with the metric, then the mechanism.',
  })
  off()

  const after = store.relationGraph()
  const labels = after.projectContexts[project.id].map((c) => c.label)
  assert.ok(labels.includes('Test connector'), 'scope-context added the context')
  assert.ok(!labels.includes(seedLabel), 'unscope-context removed the seeded context')
  assert.equal(
    after.projectInstructions[project.id],
    'Lead with the metric, then the mechanism.',
    'set-project-instructions overlaid the instructions',
  )
  assert.deepEqual(ops, ['scope-context', 'unscope-context', 'set-project-instructions'], 'each canonical write broadcast relation.applied')
})
