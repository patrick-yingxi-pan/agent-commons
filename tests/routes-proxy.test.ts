/** Agent-to-agent proxy route (docs/agent-commons.md, D15) — A's Agent asks B's Agent to
 *  act on B's private resource. B acts under *its own* authority and returns only the result;
 *  the requester never holds a B credential (the structural D12 wall). Mock fulfilment. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from '../server/store.ts'
import { call } from './helpers/http.ts'

test('agent-to-agent proxy (D15): B acts under its OWN authority; A receives only the result', async () => {
  // A's Agent (the requester) — never holds a B credential.
  const a = store.createAgent({ label: 'Requester A', systemPrompt: 'p', tools: [], instructions: '' })
  // B's Agent — restricted to Linear; it is the owner-side proxy.
  const b = store.createAgent({
    label: 'Owner B', systemPrompt: 'p', tools: [], instructions: '', authority: { connectors: ['Linear'] },
  })

  // A asks B to read a connector B admits → fulfilled, performed by B; only the output comes back.
  const ok = await call('POST', `/agents/${b.id}/proxy`, { fromAgentId: a.id, capability: 'connector.read', target: 'Linear' })
  assert.equal(ok.status, 200)
  assert.equal(ok.json.status, 'fulfilled')
  assert.equal(ok.json.actedBy, b.id)
  assert.ok(ok.json.output)
  assert.ok(!('credential' in ok.json) && !('token' in ok.json), 'no secret crosses back')

  // A asks B for a connector B does NOT hold → denied — B's *own* authority bounds it, not A's.
  const denied = await call('POST', `/agents/${b.id}/proxy`, { fromAgentId: a.id, capability: 'connector.read', target: 'Gmail' })
  assert.equal(denied.status, 200)
  assert.equal(denied.json.status, 'denied')
  assert.equal(denied.json.output, undefined)

  // Unknown owner Agent → 404; an invalid capability → 400.
  const missing = await call('POST', '/agents/ghost/proxy', { fromAgentId: a.id, capability: 'connector.read', target: 'Linear' })
  assert.equal(missing.status, 404)
  const bad = await call('POST', `/agents/${b.id}/proxy`, { fromAgentId: a.id, capability: 'connector.delete', target: 'Linear' })
  assert.equal(bad.status, 400)
})
