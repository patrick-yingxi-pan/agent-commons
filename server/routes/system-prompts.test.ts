/** System-prompt CRUD on the wire (docs/agent-commons.md, D10) — the Agents hub's
 *  create / patch / delete. A plain registry (prompt text isn't a capability, so no
 *  attenuation funnel); DELETE refuses the protected default and any prompt an Agent
 *  still references (409). The in-memory store is shared across the run, so each case
 *  uses its own labels and only deletes what it created. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from '../store/index.ts'
import { SP_DEFAULT_ID } from '../data/prompts.ts'
import { call } from '../testkit/http.ts'

test('POST creates a revisioned prompt; GET lists it; sparse PATCH orders its definition', async () => {
  const created = await call('POST', '/system-prompts', {
    label: '  Wire prompt  ',
    body: '  Be terse.  ',
    targetFamily: '  open  ',
  })
  assert.equal(created.status, 200)
  assert.ok(created.json.id.startsWith('sp-'))
  assert.equal(created.json.label, 'Wire prompt')
  assert.equal(created.json.body, 'Be terse.')
  assert.equal(created.json.targetFamily, 'open')
  assert.equal(created.json.definitionRevision, 0)

  const one = await call('GET', `/system-prompts/${created.json.id}`)
  assert.equal(one.status, 200)
  assert.equal(one.json.label, 'Wire prompt')

  const patched = await call('PATCH', `/system-prompts/${created.json.id}`, {
    label: 'Renamed',
    expectedRevision: 0,
  })
  assert.equal(patched.status, 200)
  assert.equal(patched.json.label, 'Renamed')
  assert.equal(patched.json.body, 'Be terse.')
  // The patch is a real merge — the untouched target family survives.
  assert.equal(patched.json.targetFamily, 'open')
  assert.equal(patched.json.definitionRevision, 1)
})

test('PATCH compare-and-swap rejects stale writes and replays one logical edit once', async () => {
  const created = await call('POST', '/system-prompts', {
    label: 'CAS prompt',
    body: 'Opening body.',
    targetFamily: 'claude',
  })
  const id = created.json.id
  const headers = { 'idempotency-key': `system-prompt-cas-${id}` }
  const first = await call('PATCH', `/system-prompts/${id}`, {
    label: 'CAS prompt renamed',
    expectedRevision: 0,
  }, headers)
  assert.equal(first.status, 200)
  assert.equal(first.json.definitionRevision, 1)

  const replay = await call('PATCH', `/system-prompts/${id}`, {
    label: 'CAS prompt renamed',
    expectedRevision: 0,
  }, headers)
  assert.equal(replay.status, 200)
  assert.equal(replay.json.definitionRevision, 1, 'one logical retry cannot advance the definition twice')

  const remote = await call('PATCH', `/system-prompts/${id}`, {
    body: 'Remote body.',
    expectedRevision: 1,
  })
  assert.equal(remote.status, 200)
  assert.equal(remote.json.definitionRevision, 2)

  const stale = await call('PATCH', `/system-prompts/${id}`, {
    targetFamily: 'openai',
    expectedRevision: 1,
  })
  assert.equal(stale.status, 409)
  assert.equal(stale.json.error.code, 'conflict')

  const current = await call('GET', `/system-prompts/${id}`)
  assert.equal(current.json.label, 'CAS prompt renamed')
  assert.equal(current.json.body, 'Remote body.')
  assert.equal(current.json.targetFamily, 'claude')
  assert.equal(current.json.definitionRevision, 2)
})

test('POST replays one logical prompt creation without minting a duplicate', async () => {
  const label = `Idempotent prompt ${Date.now()}`
  const body = { label, body: 'One logical prompt.', targetFamily: 'claude' }
  const headers = { 'idempotency-key': `system-prompt-create-${label}` }
  const first = await call('POST', '/system-prompts', body, headers)
  const replay = await call('POST', '/system-prompts', body, headers)
  assert.equal(first.status, 200)
  assert.equal(replay.status, 200)
  assert.equal(replay.json.id, first.json.id)
  assert.equal(
    store.listSystemPrompts().filter((prompt) => prompt.label === label).length,
    1,
    'the replay cannot mint a second registry row',
  )
})

test('prompt mutation shapes reject ownership, identity, revision, and unbounded text forgery', async () => {
  const forgedCreate = await call('POST', '/system-prompts', {
    label: 'Forged prompt',
    body: 'body',
    targetFamily: 'claude',
    tenantId: 'tenant-attacker',
  })
  assert.equal(forgedCreate.status, 400)

  const created = await call('POST', '/system-prompts', {
    label: 'Strict prompt',
    body: 'body',
    targetFamily: 'claude',
  })
  for (const patch of [
    {},
    { tenantId: 'tenant-attacker' },
    { definitionRevision: 99 },
    { id: 'replacement-id' },
    { body: 'x'.repeat(8001) },
    { expectedRevision: -1 },
    { expectedRevision: 0 },
  ]) {
    const response = await call('PATCH', `/system-prompts/${created.json.id}`, patch)
    assert.equal(response.status, 400, `rejected ${JSON.stringify(Object.keys(patch))}`)
  }
  const current = await call('GET', `/system-prompts/${created.json.id}`)
  assert.equal(current.json.label, 'Strict prompt')
  assert.equal(current.json.definitionRevision, 0)
})

test('editing a library prompt does not rewrite Agents that copied its earlier body', async () => {
  const prompt = store.createSystemPrompt({ label: 'Snapshot source', body: 'Original body.', targetFamily: 'claude' })
  const agent = store.createAgent({
    label: 'Prompt snapshot Agent',
    systemPrompt: prompt.body,
    systemPromptId: prompt.id,
    tools: [],
    instructions: '',
  })
  const patched = await call('PATCH', `/system-prompts/${prompt.id}`, {
    body: 'New library body.',
    expectedRevision: 0,
  })
  assert.equal(patched.status, 200)
  assert.equal(store.listAgents().find((candidate) => candidate.id === agent.id)?.systemPrompt, 'Original body.')
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
