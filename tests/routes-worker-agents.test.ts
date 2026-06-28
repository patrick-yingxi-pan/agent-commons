/** Worker-Agent CRUD on the wire (docs/agent-commons.md, D6) — the Agents hub's create /
 *  patch / delete. POST resolves the prompt body from `systemPromptId` and defaults tools
 *  to the full catalog, then runs the D8 funnel (an over-grant is a 400); DELETE refuses
 *  the protected default and any Agent a Commission still assigns (409). The in-memory
 *  store is shared across the run, so each case uses its own labels. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from '../server/store.ts'
import { DEFAULT_AGENT } from '../server/data/workers.ts'
import { SP_DEFAULT_ID } from '../server/data/prompts.ts'
import { call } from './helpers/http.ts'

test('POST resolves the prompt body from systemPromptId and defaults tools to the catalog', async () => {
  const created = await call('POST', '/agents', { label: 'Reviewer', systemPromptId: 'sp-concise-reviewer' })
  assert.equal(created.status, 200)
  assert.ok(created.json.id.startsWith('agent-'))
  assert.equal(created.json.systemPromptId, 'sp-concise-reviewer')
  // The body is resolved from the library entry, not echoed from the request.
  assert.equal(created.json.systemPrompt, store.getSystemPrompt('sp-concise-reviewer')!.body)
  // Tools default to the full catalog (the default Agent's set).
  assert.equal(created.json.tools.length, DEFAULT_AGENT.tools.length)

  const one = await call('GET', `/agents/${created.json.id}`)
  assert.equal(one.status, 200)
  assert.equal(one.json.label, 'Reviewer')
})

test('POST with no systemPromptId falls back to the default body', async () => {
  const created = await call('POST', '/agents', { label: 'Bare agent' })
  assert.equal(created.status, 200)
  assert.equal(created.json.systemPromptId, undefined)
  assert.equal(created.json.systemPrompt, store.getSystemPrompt(SP_DEFAULT_ID)!.body)
})

test('PATCH edits fields; clearing the prompt id reverts to the default body', async () => {
  const created = await call('POST', '/agents', { label: 'Editable', systemPromptId: 'sp-concise-reviewer' })
  const id = created.json.id

  const patched = await call('PATCH', `/agents/${id}`, { label: 'Edited', instructions: 'Be brief.' })
  assert.equal(patched.status, 200)
  assert.equal(patched.json.label, 'Edited')
  assert.equal(patched.json.instructions, 'Be brief.')
  // Untouched prompt binding survives the patch.
  assert.equal(patched.json.systemPromptId, 'sp-concise-reviewer')

  // Clearing the prompt ('' = default) reverts the body and drops the id.
  const cleared = await call('PATCH', `/agents/${id}`, { systemPromptId: '' })
  assert.equal(cleared.status, 200)
  assert.equal(cleared.json.systemPromptId, undefined)
  assert.equal(cleared.json.systemPrompt, store.getSystemPrompt(SP_DEFAULT_ID)!.body)
})

test('POST validates named ids and required fields', async () => {
  const noLabel = await call('POST', '/agents', { systemPromptId: 'sp-concise-reviewer' })
  assert.equal(noLabel.status, 400)

  const badProvider = await call('POST', '/agents', { label: 'x', providerId: 'no-such-provider' })
  assert.equal(badProvider.status, 404)

  const badPrompt = await call('POST', '/agents', { label: 'x', systemPromptId: 'no-such-prompt' })
  assert.equal(badPrompt.status, 404)
})

test('POST rejects an authority over its provider (the D8 funnel, on the wire)', async () => {
  // A provider that grants only the Linear connector.
  const provider = store.createProvider({
    label: 'Linear-only',
    modelFamily: 'claude',
    effortLevels: ['Low'],
    authority: { connectors: ['linear'] },
  })
  // An Agent reaching for Figma too exceeds that grant — a 400.
  const over = await call('POST', '/agents', {
    label: 'Greedy agent',
    providerId: provider.id,
    authority: { connectors: ['linear', 'figma'] },
  })
  assert.equal(over.status, 400)
  assert.equal(over.json.error.code, 'bad_request')
})

test('DELETE removes an agent; a second DELETE 404s; the default is refused (409)', async () => {
  const created = await call('POST', '/agents', { label: 'Disposable agent' })
  const del = await call('DELETE', `/agents/${created.json.id}`)
  assert.equal(del.status, 200)
  assert.deepEqual(del.json, { ok: true })

  const again = await call('DELETE', `/agents/${created.json.id}`)
  assert.equal(again.status, 404)

  const protectedDel = await call('DELETE', `/agents/${DEFAULT_AGENT.id}`)
  assert.equal(protectedDel.status, 409)
  assert.equal(protectedDel.json.error.code, 'conflict')
})

test('DELETE refuses an agent a Commission still assigns (409)', async () => {
  const created = await call('POST', '/agents', { label: 'Commissioned agent' })
  store.createCommission({ agentId: created.json.id, projectId: 'p-insights' })
  const blocked = await call('DELETE', `/agents/${created.json.id}`)
  assert.equal(blocked.status, 409)
  assert.equal(blocked.json.error.code, 'conflict')
})
