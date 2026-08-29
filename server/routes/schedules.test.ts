/** PATCH /schedules/:id is the routine's entity-edit seam — the detail page edits
 *  a routine's OWN fields (name, prompt, cadence, model, notify-on-failure, …)
 *  through it, while cross-entity bindings (deliver-to, add-tool) go through
 *  /relations/ops instead. These lock that the patch merges only the fields it's
 *  given, never disturbs id / runs / unspecified fields, still toggles enabled, and
 *  404s an unknown routine. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { call } from '../testkit/http.ts'

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
