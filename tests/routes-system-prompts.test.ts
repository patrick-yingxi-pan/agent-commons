/** System-prompt CRUD on the wire (docs/agent-commons.md, D10) — the Agents hub's
 *  create / patch / delete. A plain registry (prompt text isn't a capability, so no
 *  attenuation funnel); DELETE refuses the protected default and any prompt an Agent
 *  still references (409). The in-memory store is shared across the run, so each case
 *  uses its own labels and only deletes what it created. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from '../server/store.ts'
import { SP_DEFAULT_ID } from '../server/data/prompts.ts'
import { call } from './helpers/http.ts'

test('POST creates a prompt; GET lists it; PATCH edits its fields', async () => {
  const created = await call('POST', '/system-prompts', {
    label: 'Wire prompt',
    body: 'Be terse.',
    targetFamily: 'open',
  })
  assert.equal(created.status, 200)
  assert.ok(created.json.id.startsWith('sp-'))
  assert.equal(created.json.targetFamily, 'open')

  const one = await call('GET', `/system-prompts/${created.json.id}`)
  assert.equal(one.status, 200)
  assert.equal(one.json.label, 'Wire prompt')

  const patched = await call('PATCH', `/system-prompts/${created.json.id}`, {
    label: 'Renamed',
    body: 'Be terse and precise.',
  })
  assert.equal(patched.status, 200)
  assert.equal(patched.json.label, 'Renamed')
  assert.equal(patched.json.body, 'Be terse and precise.')
  // The patch is a real merge — the untouched target family survives.
  assert.equal(patched.json.targetFamily, 'open')
})

test('POST without required fields is a 400; PATCH of an unknown id is a 404', async () => {
  const bad = await call('POST', '/system-prompts', { label: 'No body' })
  assert.equal(bad.status, 400)
  assert.equal(bad.json.error.code, 'bad_request')

  const missing = await call('PATCH', '/system-prompts/no-such-prompt', { label: 'x' })
  assert.equal(missing.status, 404)
  assert.equal(missing.json.error.code, 'not_found')
})

test('DELETE removes an unreferenced prompt; a second DELETE 404s', async () => {
  const created = await call('POST', '/system-prompts', {
    label: 'Disposable',
    body: 'temp',
    targetFamily: 'claude',
  })
  const del = await call('DELETE', `/system-prompts/${created.json.id}`)
  assert.equal(del.status, 200)
  assert.deepEqual(del.json, { ok: true })

  const again = await call('DELETE', `/system-prompts/${created.json.id}`)
  assert.equal(again.status, 404)
})

test('DELETE refuses the default prompt (409 — the default Agent is sourced from it)', async () => {
  const del = await call('DELETE', `/system-prompts/${SP_DEFAULT_ID}`)
  assert.equal(del.status, 409)
  assert.equal(del.json.error.code, 'conflict')
})

test('DELETE refuses a prompt an Agent still references (409)', async () => {
  const prompt = store.createSystemPrompt({ label: 'Referenced', body: 'b', targetFamily: 'claude' })
  store.createAgent({
    label: 'Prompt user',
    systemPrompt: prompt.body,
    systemPromptId: prompt.id,
    tools: [],
    instructions: '',
  })
  const blocked = await call('DELETE', `/system-prompts/${prompt.id}`)
  assert.equal(blocked.status, 409)
  assert.equal(blocked.json.error.code, 'conflict')
})
