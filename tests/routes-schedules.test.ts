/** PATCH /schedules/:id is the routine's entity-edit seam — the detail page edits
 *  a routine's OWN fields (name, prompt, cadence, model, notify-on-failure, …)
 *  through it, while cross-entity bindings (deliver-to, add-tool) go through
 *  /relations/ops instead. These lock that the patch merges only the fields it's
 *  given, never disturbs id / runs / unspecified fields, still toggles enabled, and
 *  404s an unknown routine. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { call } from './helpers/http.ts'

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

test('PATCH /schedules/:id still flips enabled (the original toggle path keeps working)', async () => {
  const list = await call('GET', '/schedules')
  const task = list.json[0]
  const res = await call('PATCH', `/schedules/${task.id}`, { enabled: !task.enabled })
  assert.equal(res.status, 200)
  assert.equal(res.json.enabled, !task.enabled)
})

test('PATCH /schedules/:id 404s for an unknown routine', async () => {
  const res = await call('PATCH', '/schedules/s-does-not-exist', { name: 'x' })
  assert.equal(res.status, 404)
})
