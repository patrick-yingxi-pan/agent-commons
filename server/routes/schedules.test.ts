/** PATCH /schedules/:id is the routine's entity-edit seam — the detail page edits
 *  a routine's OWN fields (name, prompt, cadence, model, notify-on-failure, …)
 *  through it, while cross-entity bindings (deliver-to, add-tool) go through
 *  /relations/ops instead. These lock that the patch merges only the fields it's
 *  given, never disturbs id / runs / unspecified fields, still toggles enabled, and
 *  404s an unknown routine. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { call } from '../testkit/http.ts'
import { manualScheduleRunId } from '../scheduleRunIdentity.ts'
import { scheduleCreationId } from '../scheduleCreationIdentity.ts'
import { store } from '../store/index.ts'

async function createRoutine(name: string) {
  const template = (await call('GET', '/schedule-templates')).json[0]
  const created = await call('POST', '/schedules', {
    seed: { ...template.seed, name, runs: [] },
  })
  assert.equal(created.status, 200)
  return created.json
}

test('a keyed routine create owns one tenant-scoped durable row beyond response-cache lifetime', async () => {
  const me = (await call('GET', '/me')).json
  const template = (await call('GET', '/schedule-templates')).json[0]
  const key = `durable-routine-${Date.now().toString(36)}`
  const expectedId = scheduleCreationId(me.tenant.id, key)
  const seed = { ...template.seed, name: `Durable routine ${key}`, runs: [] }
  const created = await call('POST', '/schedules', { seed }, { 'idempotency-key': key })
  assert.equal(created.status, 200)
  assert.equal(created.json.id, expectedId)

  const replay = await call('POST', '/schedules', { seed }, { 'idempotency-key': key })
  assert.equal(replay.status, 200)
  assert.equal(replay.headers['idempotency-replayed'], 'true')

  const restartStyleReplay = store.addSchedule(
    { ...seed, name: 'A changed retry body must not create another row', tenantId: me.tenant.id },
    expectedId,
  )
  assert.equal(restartStyleReplay.id, expectedId)
  assert.equal(restartStyleReplay.name, seed.name)
  assert.equal(
    store.listSchedules(me.tenant.id).filter((task) => task.id === expectedId).length,
    1,
    'persisted identity, rather than only the HTTP response cache, deduplicates retry',
  )
})

test('PATCH /schedules/:id merges only the provided fields (id, runs, and the rest untouched)', async () => {
  const list = await call('GET', '/schedules')
  assert.equal(list.status, 200)
  const task = list.json[0]

  const res = await call('PATCH', `/schedules/${task.id}`, { name: 'Renamed via PATCH', notifyOnFailure: false })
  assert.equal(res.status, 200)
  assert.equal(res.json.name, 'Renamed via PATCH', 'name patched')
  assert.equal(res.json.notifyOnFailure, false, 'notifyOnFailure persisted')
  assert.equal(res.json.prompt, task.prompt, 'unspecified prompt is untouched')
  assert.equal(res.json.cadence, task.cadence, 'unspecified cadence is untouched')
  assert.equal(res.json.id, task.id, 'id is never overwritten by a patch')
  assert.equal(res.json.runs.length, task.runs.length, 'run history is untouched by a field patch')

  // The change is live on the next read (server is the source of truth).
  const after = await call('GET', '/schedules')
  assert.equal(after.json.find((t: { id: string }) => t.id === task.id).name, 'Renamed via PATCH')
})

test('PATCH /schedules/:id sets enabled to the explicit value (the toggle path keeps working)', async () => {
  const list = await call('GET', '/schedules')
  const task = list.json[0]
  const res = await call('PATCH', `/schedules/${task.id}`, { enabled: !task.enabled })
  assert.equal(res.status, 200)
  assert.equal(res.json.enabled, !task.enabled)
})

test('Run now replays one durable logical run and acknowledgement', async () => {
  const task = await createRoutine(`Idempotent manual run ${Date.now().toString(36)}`)
  const key = `manual-run-${task.id}`
  const headers = { 'idempotency-key': key }
  const started = await call('POST', `/schedules/${task.id}/run`, undefined, headers)
  assert.equal(started.status, 200)
  assert.equal(started.json.id, manualScheduleRunId(key))

  const replay = await call('POST', `/schedules/${task.id}/run`, undefined, headers)
  assert.equal(replay.status, 200)
  assert.deepEqual(replay.json, started.json)
  assert.equal(replay.headers['idempotency-replayed'], 'true')
  const current = (await call('GET', '/schedules')).json.find(
    (candidate: { id: string }) => candidate.id === task.id,
  )
  assert.equal(current.runs.length, 1, 'the logical request creates one run row')
})

test('a keyed manual run never acknowledges a different overlapping run', async () => {
  const task = await createRoutine(`Overlapping manual run ${Date.now().toString(36)}`)
  const active = await call('POST', `/schedules/${task.id}/run`)
  assert.equal(active.status, 200)

  const key = `held-manual-run-${task.id}`
  const refused = await call('POST', `/schedules/${task.id}/run`, undefined, { 'idempotency-key': key })
  assert.equal(refused.status, 409)
  assert.match(refused.json.error.message, /already in progress/i)
  assert.notEqual(active.json.id, manualScheduleRunId(key))
  const current = (await call('GET', '/schedules')).json.find(
    (candidate: { id: string }) => candidate.id === task.id,
  )
  assert.deepEqual(current.runs.map((run: { id: string }) => run.id), [active.json.id])
})

test('PATCH /schedules/:id with no enabled key leaves enabled unchanged (no implicit toggle)', async () => {
  const list = await call('GET', '/schedules')
  const task = list.json[0]
  const res = await call('PATCH', `/schedules/${task.id}`, { name: task.name })
  assert.equal(res.status, 200)
  assert.equal(res.json.enabled, task.enabled, 'a patch without `enabled` never flips it — the UI sends the resolved value')
})

test('cadence edits persist a server-derived timezone cursor and downtime policy', async () => {
  const task = (await call('GET', '/schedules')).json[0]
  const before = Date.now()
  const res = await call('PATCH', `/schedules/${task.id}`, {
    enabled: true,
    cadence: 'Daily · 9:00 AM',
    trigger: 'client supplied lie',
    timezone: 'UTC',
    missedFirePolicy: 'catch-up-once',
    next: 'client supplied lie',
  })
  assert.equal(res.status, 200)
  assert.equal(res.json.missedFirePolicy, 'catch-up-once')
  assert.equal(res.json.timezone, 'UTC')
  assert.equal(res.json.trigger, 'every day at 9:00 AM')
  assert.ok(res.json.nextFireAt > before, 'the server stamps a future durable cursor')
  assert.notEqual(res.json.next, 'client supplied lie', 'next-run copy is server-derived')
})

test('invalid cadence and timezone edits are 400s that leave the definition untouched', async () => {
  const task = (await call('GET', '/schedules')).json[0]
  const badZone = await call('PATCH', `/schedules/${task.id}`, { timezone: 'Mars/Olympus_Mons' })
  assert.equal(badZone.status, 400)
  assert.match(badZone.json.error.message, /timezone/i)

  const badCadence = await call('PATCH', `/schedules/${task.id}`, { cadence: 'whenever it feels right' })
  assert.equal(badCadence.status, 400)
  const after = (await call('GET', '/schedules')).json.find((candidate: { id: string }) => candidate.id === task.id)
  assert.equal(after.timezone, task.timezone)
  assert.equal(after.cadence, task.cadence)
  assert.equal(after.revision, task.revision)
})

test('a paused routine seed still needs an executable cadence', async () => {
  const templates = await call('GET', '/schedule-templates')
  const seed = { ...templates.json[0].seed, cadence: 'sometime later', enabled: false }
  const res = await call('POST', '/schedules', { seed })
  assert.equal(res.status, 400)
  assert.match(res.json.error.message, /cadence/i)
})

test('routine execution bindings persist ids, derive their label, and refuse foreground Session providers', async () => {
  const task = (await call('GET', '/schedules')).json[0]
  const agent = (await call('GET', '/agents')).json[0]
  const provider = (await call('GET', '/providers')).json.find((candidate: { kind?: string; models?: unknown[] }) =>
    candidate.kind !== 'session' && (candidate.models?.length ?? 0) > 0)
  assert.ok(agent && provider)
  const model = provider.models[0]
  const effort = model.effortLevels?.[0] ?? provider.effortLevels?.[0]
  const patched = await call('PATCH', `/schedules/${task.id}`, {
    agentId: agent.id,
    providerId: provider.id,
    modelId: model.id,
    effort: effort ?? null,
  })
  assert.equal(patched.status, 200)
  assert.equal(patched.json.agentId, agent.id)
  assert.equal(patched.json.providerId, provider.id)
  assert.equal(patched.json.modelId, model.id)
  assert.ok(patched.json.model.includes(model.label), 'the mutable display face is server-derived from ids')

  const badModel = await call('PATCH', `/schedules/${task.id}`, { modelId: 'model-that-does-not-exist' })
  assert.equal(badModel.status, 400)

  const sessionProvider = await call('POST', '/providers', {
    kind: 'session',
    label: 'Foreground relay for schedule refusal',
    modelFamily: 'claude',
    effortLevels: [],
  })
  assert.equal(sessionProvider.status, 200)
  const foreground = await call('PATCH', `/schedules/${task.id}`, { providerId: sessionProvider.json.id })
  assert.equal(foreground.status, 400)
  assert.match(foreground.json.error.message, /unattended/i)
})

test('routine definition PATCH refuses stale revisions and replays one logical retry', async () => {
  const list = await call('GET', '/schedules')
  const task = list.json[0]
  const revision = task.revision ?? 0
  const headers = { 'idempotency-key': `schedule-definition-${task.id}-${revision}` }

  const renamed = await call('PATCH', `/schedules/${task.id}`, {
    name: 'Revision-safe routine',
    expectedRevision: revision,
  }, headers)
  assert.equal(renamed.status, 200)
  assert.equal(renamed.json.revision, revision + 1)

  const replay = await call('PATCH', `/schedules/${task.id}`, {
    name: 'Revision-safe routine',
    expectedRevision: revision,
  }, headers)
  assert.equal(replay.status, 200)
  assert.equal(replay.json.revision, revision + 1, 'the same logical retry advances once')

  const stale = await call('PATCH', `/schedules/${task.id}`, {
    enabled: !renamed.json.enabled,
    expectedRevision: revision,
  })
  assert.equal(stale.status, 409)
  assert.equal(stale.json.error.code, 'conflict')

  const after = (await call('GET', '/schedules')).json.find((candidate: { id: string }) => candidate.id === task.id)
  assert.equal(after.enabled, renamed.json.enabled, 'a refused patch changes no field')
  assert.equal(after.revision, revision + 1)

  const current = await call('PATCH', `/schedules/${task.id}`, {
    enabled: !renamed.json.enabled,
    expectedRevision: revision + 1,
  })
  assert.equal(current.status, 200)
  assert.equal(current.json.revision, revision + 2)
})

test('routine definition revision is independent of run history and validates its precondition', async () => {
  const list = await call('GET', '/schedules')
  const task = list.json[0]
  const revision = task.revision ?? 0

  const run = await call('POST', `/schedules/${task.id}/run`)
  assert.equal(run.status, 200)
  const afterRun = (await call('GET', '/schedules')).json.find((candidate: { id: string }) => candidate.id === task.id)
  assert.equal(afterRun.revision, revision, 'run activity does not manufacture a definition conflict')

  const malformed = await call('PATCH', `/schedules/${task.id}`, { name: 'No', expectedRevision: -1 })
  assert.equal(malformed.status, 400)

  const legacy = await call('PATCH', `/schedules/${task.id}`, { name: 'Legacy routine client' })
  assert.equal(legacy.status, 200)
  assert.equal(legacy.json.revision, revision + 1, 'a legacy unconditional write still advances ordering')
})

test('PATCH /schedules/:id 404s for an unknown routine', async () => {
  const res = await call('PATCH', '/schedules/s-does-not-exist', { name: 'x' })
  assert.equal(res.status, 404)
})

test('DELETE pins the reviewed routine revision, replays once, and converges after durable absence', async () => {
  const task = await createRoutine(`Revision-safe deletion ${Date.now().toString(36)}`)
  const changed = await call('PATCH', `/schedules/${task.id}`, {
    name: `${task.name} changed elsewhere`,
    expectedRevision: task.revision ?? 0,
  })
  assert.equal(changed.status, 200)

  const stale = await call('DELETE', `/schedules/${task.id}`, {
    expectedRevision: task.revision ?? 0,
  })
  assert.equal(stale.status, 409)
  assert.equal(stale.json.error.code, 'conflict')
  assert.ok(
    (await call('GET', '/schedules')).json.some((candidate: { id: string }) => candidate.id === task.id),
    'a stale destructive precondition changes nothing',
  )

  const headers = { 'idempotency-key': `schedule-delete-${task.id}` }
  const removed = await call('DELETE', `/schedules/${task.id}`, {
    expectedRevision: changed.json.revision,
  }, headers)
  assert.equal(removed.status, 200)
  assert.deepEqual(removed.json, { ok: true })

  const replay = await call('DELETE', `/schedules/${task.id}`, {
    expectedRevision: changed.json.revision,
  }, headers)
  assert.equal(replay.status, removed.status)
  assert.deepEqual(replay.json, removed.json, 'the same logical request replays its acknowledgement')
  assert.equal(replay.headers['idempotency-replayed'], 'true')

  const afterRestartStyleReplay = await call('DELETE', `/schedules/${task.id}`, {
    expectedRevision: changed.json.revision,
  })
  assert.equal(afterRestartStyleReplay.status, 200, 'absence converges when an idempotency cache cannot answer')
  assert.ok(
    !(await call('GET', '/schedules')).json.some((candidate: { id: string }) => candidate.id === task.id),
  )
})

test('DELETE validates its revision precondition and keeps legacy unconditional deletion', async () => {
  const task = await createRoutine(`Legacy deletion ${Date.now().toString(36)}`)
  const malformed = await call('DELETE', `/schedules/${task.id}`, { expectedRevision: -1 })
  assert.equal(malformed.status, 400)
  assert.ok((await call('GET', '/schedules')).json.some((candidate: { id: string }) => candidate.id === task.id))

  const legacy = await call('DELETE', `/schedules/${task.id}`)
  assert.equal(legacy.status, 200)
})

test('DELETE keeps a foreign routine existence-hidden and unchanged', async () => {
  const task = await createRoutine(`Owned deletion ${Date.now().toString(36)}`)
  const denied = await call(
    'DELETE',
    `/schedules/${task.id}`,
    { expectedRevision: task.revision ?? 0 },
    { 'x-tenant-id': 'tenant-routine-delete-stranger' },
  )
  assert.equal(denied.status, 404)
  assert.ok((await call('GET', '/schedules')).json.some((candidate: { id: string }) => candidate.id === task.id))
  assert.equal((await call('DELETE', `/schedules/${task.id}`, { expectedRevision: task.revision ?? 0 })).status, 200)
})
