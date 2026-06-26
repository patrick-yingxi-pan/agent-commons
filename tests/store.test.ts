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

test('registry: native mode seeds the co-located agent with fs/terminal/process', () => {
  const ids = store.registry.list().map((a) => a.id)
  assert.ok(ids.includes('agent-local'))
  const local = store.registry.get('agent-local')
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
