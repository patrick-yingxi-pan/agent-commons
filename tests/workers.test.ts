/** Worker Agent (docs/agent-commons.md, D6) — the seeded degenerate Agent, its
 *  resolution, and its binding to a Conversation. The bare word "Agent" is the
 *  worker here; the host-bound type is a Runner (tests/registry.test.ts). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from '../server/store.ts'
import { DEFAULT_AGENT } from '../server/data/workers.ts'
import { TOOL_NAMES } from '../server/model/tools.ts'
import { estimateTokens, BudgetError } from '../server/usage.ts'
import { call } from './helpers/http.ts'

test('the default Agent carries the whole tool catalog and a non-empty prompt', () => {
  assert.deepEqual(DEFAULT_AGENT.tools, TOOL_NAMES)
  assert.ok(DEFAULT_AGENT.systemPrompt.length > 0)
  assert.equal(DEFAULT_AGENT.instructions, '')
})

test('store.getAgent resolves to the default for unset / unknown ids', () => {
  assert.equal(store.getAgent().id, DEFAULT_AGENT.id)
  assert.equal(store.getAgent('no-such-agent').id, DEFAULT_AGENT.id)
  assert.equal(store.getAgent(DEFAULT_AGENT.id).id, DEFAULT_AGENT.id)
  assert.ok(store.listAgents().some((a) => a.id === DEFAULT_AGENT.id))
})

test('createSession binds the Conversation to the default Agent', () => {
  const s = store.createSession('a fresh thread')
  assert.equal(s.agentId, DEFAULT_AGENT.id)
})

test('usage meters the resolved Agent system prompt (the binding is load-bearing)', () => {
  // A fresh, non-demo Conversation bound to the default Agent: its system-prompt
  // category is exactly the Agent's prompt size (no messages, no instructions).
  const s = store.createSession('measure my prompt')
  const seg = store.usage(s.id).context.segments.find((x) => x.id === 'systemPrompt')!
  assert.equal(seg.rawTokens, estimateTokens(DEFAULT_AGENT.systemPrompt))
})

test('GET /agents returns the worker-Agent registry; an unknown id 404s', async () => {
  const list = await call('GET', '/agents')
  assert.equal(list.status, 200)
  assert.ok(list.json.some((a: any) => a.id === DEFAULT_AGENT.id))

  const one = await call('GET', `/agents/${DEFAULT_AGENT.id}`)
  assert.equal(one.status, 200)
  assert.equal(one.json.id, DEFAULT_AGENT.id)

  const missing = await call('GET', '/agents/nope')
  assert.equal(missing.status, 404)
  assert.equal(missing.json.error.code, 'not_found')
})

test('createAgent mints a within-plan budget through the funnel, rejects an over-plan one', () => {
  const capped = store.createAgent({
    label: 'Capped',
    systemPrompt: 'p',
    tools: [],
    instructions: '',
    budget: { windows: [{ label: '5-hour limit', ceiling: 100_000 }] },
  })
  assert.ok(capped.id.startsWith('agent-'))
  assert.equal(capped.budget?.windows[0].ceiling, 100_000)
  assert.equal(store.getAgent(capped.id).id, capped.id)
  // The funnel is the single seam that enforces agent ⊆ plan — an over-grant throws.
  assert.throws(
    () =>
      store.createAgent({
        label: 'Greedy',
        systemPrompt: 'p',
        tools: [],
        instructions: '',
        budget: { windows: [{ label: '5-hour limit', ceiling: 5_000_000 }] },
      }),
    BudgetError,
  )
})
