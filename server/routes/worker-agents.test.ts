/** Worker-Agent CRUD on the wire (docs/agent-commons.md, D6) — the Agents hub's create /
 *  patch / delete. POST is **strict** (INV-9): `providerId` and `systemPromptId` are
 *  required and must name registered entries — the API never resolves a missing binding
 *  to a default (default-flagged entries are a UI pre-selection shortcut only) — and an
 *  omitted `tools` is the EMPTY set (minimal risk; the full catalog is an explicit
 *  grant). The prompt body is resolved from the named entry, then the D8 funnel runs
 *  (an over-grant is a 400); DELETE refuses the protected default and any Agent a
 *  Commission still assigns (409). The in-memory store is shared across the run, so each
 *  case uses its own labels. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from '../store/index.ts'
import { DEFAULT_AGENT } from '../data/workers.ts'
import { TOOL_NAMES } from '../model/tools.ts'
import { DEFAULT_PROVIDER_ID } from '../../contract/index.ts'
import { call } from '../testkit/http.ts'

test('POST resolves the prompt body; an omitted tool grant is the EMPTY set (minimal risk)', async () => {
  const created = await call('POST', '/agents', {
    label: 'Reviewer',
    providerId: DEFAULT_PROVIDER_ID,
    systemPromptId: 'sp-concise-reviewer',
  })
  assert.equal(created.status, 200)
  assert.ok(created.json.id.startsWith('agent-'))
  assert.equal(created.json.providerId, DEFAULT_PROVIDER_ID)
  assert.equal(created.json.systemPromptId, 'sp-concise-reviewer')
  // The body is resolved from the library entry, not echoed from the request.
  assert.equal(created.json.systemPrompt, store.getSystemPrompt('sp-concise-reviewer')!.body)
  // No tools named ⇒ NO tools granted — the API never widens silently; the full
  // catalog is an explicit grant the dialog spells out.
  assert.equal(created.json.tools.length, 0)

  const one = await call('GET', `/agents/${created.json.id}`)
  assert.equal(one.status, 200)
  assert.equal(one.json.label, 'Reviewer')
})

test('POST with an explicit full-catalog grant carries every tool (the dialog’s checked path)', async () => {
  const created = await call('POST', '/agents', {
    label: 'Fully tooled',
    providerId: DEFAULT_PROVIDER_ID,
    systemPromptId: 'sp-concise-reviewer',
    tools: [...TOOL_NAMES],
  })
  assert.equal(created.status, 200)
  assert.deepEqual(created.json.tools, TOOL_NAMES)
})

test('GET /agent-tools serves the live catalog the explicit grant names', async () => {
  const res = await call('GET', '/agent-tools')
  assert.equal(res.status, 200)
  assert.deepEqual(res.json.tools, TOOL_NAMES)
  assert.ok(res.json.tools.length > 0)
})

test('POST refuses missing bindings — the API never resolves to a default (400)', async () => {
  // No systemPromptId: refused loudly, NOT silently defaulted (the strict-API rule —
  // a missing binding is a caller bug surfaced now, not a surprising resolution later).
  const noPrompt = await call('POST', '/agents', { label: 'Bare agent', providerId: DEFAULT_PROVIDER_ID })
  assert.equal(noPrompt.status, 400)
  // No providerId: same refusal.
  const noProvider = await call('POST', '/agents', { label: 'Bare agent', systemPromptId: 'sp-concise-reviewer' })
  assert.equal(noProvider.status, 400)
  // Empty strings are the same as missing — there is no ""-means-default.
  const empty = await call('POST', '/agents', { label: 'Bare agent', providerId: '', systemPromptId: '' })
  assert.equal(empty.status, 400)
})

test('PATCH edits fields; a present-but-empty binding is refused, never "cleared to default"', async () => {
  const created = await call('POST', '/agents', {
    label: 'Editable',
    providerId: DEFAULT_PROVIDER_ID,
    systemPromptId: 'sp-concise-reviewer',
  })
  const id = created.json.id

  const patched = await call('PATCH', `/agents/${id}`, { label: 'Edited', instructions: 'Be brief.' })
  assert.equal(patched.status, 200)
  assert.equal(patched.json.label, 'Edited')
  assert.equal(patched.json.instructions, 'Be brief.')
  // Untouched bindings survive the patch.
  assert.equal(patched.json.systemPromptId, 'sp-concise-reviewer')
  assert.equal(patched.json.providerId, DEFAULT_PROVIDER_ID)

  // '' used to mean "clear to default" — now it's a 400 and the binding is untouched.
  const cleared = await call('PATCH', `/agents/${id}`, { systemPromptId: '' })
  assert.equal(cleared.status, 400)
  const after = await call('GET', `/agents/${id}`)
  assert.equal(after.json.systemPromptId, 'sp-concise-reviewer')

  // Re-pointing to another registered prompt still works and re-resolves the body.
  const repointed = await call('PATCH', `/agents/${id}`, { systemPromptId: 'sp-open-generalist' })
  assert.equal(repointed.status, 200)
  assert.equal(repointed.json.systemPromptId, 'sp-open-generalist')
  assert.equal(repointed.json.systemPrompt, store.getSystemPrompt('sp-open-generalist')!.body)
})

test('POST validates named ids and required fields', async () => {
  const noLabel = await call('POST', '/agents', {
    providerId: DEFAULT_PROVIDER_ID,
    systemPromptId: 'sp-concise-reviewer',
  })
  assert.equal(noLabel.status, 400)

  // A NAMED-but-unknown reference is a 404 (distinct from missing, a 400).
  const badProvider = await call('POST', '/agents', {
    label: 'x',
    providerId: 'no-such-provider',
    systemPromptId: 'sp-concise-reviewer',
  })
  assert.equal(badProvider.status, 404)

  const badPrompt = await call('POST', '/agents', {
    label: 'x',
    providerId: DEFAULT_PROVIDER_ID,
    systemPromptId: 'no-such-prompt',
  })
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
    systemPromptId: 'sp-concise-reviewer',
    authority: { connectors: ['linear', 'figma'] },
  })
  assert.equal(over.status, 400)
  assert.equal(over.json.error.code, 'bad_request')
})

test('DELETE removes an agent; a second DELETE 404s; the default is refused (409)', async () => {
  const created = await call('POST', '/agents', {
    label: 'Disposable agent',
    providerId: DEFAULT_PROVIDER_ID,
    systemPromptId: 'sp-concise-reviewer',
  })
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
  const created = await call('POST', '/agents', {
    label: 'Commissioned agent',
    providerId: DEFAULT_PROVIDER_ID,
    systemPromptId: 'sp-concise-reviewer',
  })
  store.createCommission({ role: 'writer', agentId: created.json.id, projectId: 'p-insights' })
  const blocked = await call('DELETE', `/agents/${created.json.id}`)
  assert.equal(blocked.status, 409)
  assert.equal(blocked.json.error.code, 'conflict')
})
