/** Schedule relation writes and projections are tenant-scoped, including standing approvals. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { call } from '../testkit/http.ts'
import { store } from '../store/index.ts'

const OWNER = `schedule-relations-owner-${Date.now().toString(36)}`
const READER = 'tenant-beta'
const FOREIGN = `schedule-relations-foreign-${Date.now().toString(36)}`

async function createRoutine() {
  const templates = await call('GET', '/schedule-templates', undefined, { 'x-tenant-id': OWNER })
  assert.equal(templates.status, 200)
  const seed = templates.json[0].seed
  const created = await call('POST', '/schedules', {
    seed: { ...seed, name: `Schedule relation wall ${Date.now().toString(36)}`, runs: [], enabled: false },
  }, { 'x-tenant-id': OWNER })
  assert.equal(created.status, 200)
  return created.json as { id: string; name: string; cadence: string }
}

function key() {
  return { 'idempotency-key': `schedule-relation-${Date.now()}-${Math.random()}` }
}

function operations(task: { id: string; name: string; cadence: string }, projectId: string) {
  return [
    { kind: 'link-schedule-project', scheduleId: task.id, scheduleName: task.name, projectId, projectName: 'Schedule relation project' },
    { kind: 'set-schedule-session', scheduleId: task.id, scheduleName: task.name, cadence: task.cadence, sessionLabel: 'Fresh scheduled session' },
    { kind: 'set-schedule-artifact', scheduleId: task.id, scheduleName: task.name, cadence: task.cadence, artifactName: 'schedule-relation-output.md' },
    { kind: 'schedule-add-tool', scheduleId: task.id, scheduleName: task.name, cadence: task.cadence, tool: { id: 'schedule-relation-tool', label: 'Schedule relation tool', tone: 'connector' as const } },
  ]
}

test('every schedule relation op is owner-only, hides foreign/granted/unknown ids, and projects granted workflow maps', async () => {
  const task = await createRoutine()
  const project = await call('POST', '/projects', { name: `Schedule relation project ${task.id}` }, { 'x-tenant-id': OWNER })
  assert.equal(project.status, 201)
  const projectId = project.json.project.id as string
  const ops = operations(task, projectId)

  for (const op of ops) {
    const applied = await call('POST', '/relations/ops', { op }, { 'x-tenant-id': OWNER, ...key() })
    assert.equal(applied.status, 200, `${op.kind} is valid for the schedule owner`)
  }

  const grant = await call('POST', '/grants', {
    subject: { kind: 'schedule', id: task.id },
    audience: { kind: 'org', orgId: READER },
    tier: 'view',
  }, { 'x-tenant-id': OWNER })
  assert.equal(grant.status, 200)

  for (const caller of [FOREIGN, READER]) {
    for (const op of ops) {
      const before = await call('GET', '/relations', undefined, { 'x-tenant-id': OWNER })
      let events = 0
      const off = store.subscribe(() => { events += 1 })
      try {
        // Use the null/unlink form for the project relation so this assertion
        // exercises the schedule subject wall, not the separate project wall.
        const hostile = op.kind === 'link-schedule-project'
          ? { ...op, projectId: null, projectName: '' }
          : op
        const refused = await call('POST', '/relations/ops', { op: hostile }, { 'x-tenant-id': caller, ...key() })
        assert.equal(refused.status, 404, `${op.kind} must hide schedule ownership from ${caller}`)
      } finally {
        off()
      }
      assert.equal(events, 0, `${op.kind} refusal must not broadcast an event`)
      const after = await call('GET', '/relations', undefined, { 'x-tenant-id': OWNER })
      assert.deepEqual(after.json, before.json, `${op.kind} refusal must not mutate the graph`)
    }
  }

  for (const scheduleId of [`missing-${task.id}`, '']) {
    for (const operation of operations({ ...task, id: scheduleId }, projectId)) {
      let events = 0
      const off = store.subscribe(() => { events += 1 })
      try {
        const refused = await call('POST', '/relations/ops', { op: operation }, { 'x-tenant-id': OWNER, ...key() })
        assert.equal(refused.status, 404, `${operation.kind} must hide ${scheduleId || 'blank'} schedule ids`)
      } finally {
        off()
      }
      assert.equal(events, 0, `${operation.kind} unknown-id refusal must not broadcast`)
    }
  }

  const ownerGraph = await call('GET', '/relations', undefined, { 'x-tenant-id': OWNER })
  const readerGraph = await call('GET', '/relations', undefined, { 'x-tenant-id': READER })
  const foreignGraph = await call('GET', '/relations', undefined, { 'x-tenant-id': FOREIGN })
  assert.equal(ownerGraph.status, 200)
  assert.equal(readerGraph.status, 200)
  assert.equal(foreignGraph.status, 200)
  for (const field of ['scheduleProject', 'scheduleSession', 'scheduleArtifact', 'scheduleExtraTools'] as const) {
    assert.ok(Object.prototype.hasOwnProperty.call(ownerGraph.json[field], task.id), `owner sees ${field}`)
    if (field !== 'scheduleProject') {
      assert.ok(Object.prototype.hasOwnProperty.call(readerGraph.json[field], task.id), `granted reader sees approved ${field}`)
    } else {
      assert.equal(Object.prototype.hasOwnProperty.call(readerGraph.json[field], task.id), false, 'a schedule grant does not expose a private Project reference')
    }
    assert.equal(Object.prototype.hasOwnProperty.call(foreignGraph.json[field], task.id), false, `foreign reader does not see ${field}`)
  }
  assert.equal(
    Object.keys(readerGraph.json.standingApprovals).some((entry) => entry.includes(task.id)),
    false,
    'standing approval keys do not disclose an unowned routine binding',
  )
  assert.ok(Object.keys(ownerGraph.json.standingApprovals).some((entry) => entry.includes(task.id)), 'owner retains standing approval history')
  assert.equal(Object.keys(foreignGraph.json.standingApprovals).some((entry) => entry.includes(task.id)), false, 'foreign reader does not see standing approval keys')

  const unlink = await call('POST', '/relations/ops', {
    op: { kind: 'link-schedule-project', scheduleId: task.id, scheduleName: task.name, projectId: null, projectName: 'Schedule relation project' },
  }, { 'x-tenant-id': OWNER, ...key() })
  assert.equal(unlink.status, 200)
  const readerAfterUnlink = await call('GET', '/relations', undefined, { 'x-tenant-id': READER })
  assert.equal(Object.prototype.hasOwnProperty.call(readerAfterUnlink.json.scheduleProject, task.id), true, 'granted reader sees the explicit unfiled schedule relation')
  assert.equal(readerAfterUnlink.json.scheduleProject[task.id], null)
})
