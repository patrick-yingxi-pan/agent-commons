/** The detective audit read route (docs/agent-commons.md, D15/OQ7) — GET /audit returns
 *  the cross-user effect trail, newest first, recording denied attempts as well as
 *  fulfilled ones. The `audit.entry` event wiring is locked by contract-boundaries. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from '../server/store.ts'
import { call } from './helpers/http.ts'

test('GET /audit returns the trail (newest first); a denied proxy is recorded too', async () => {
  const b = store.createAgent({ label: 'Route B', systemPrompt: 'p', tools: [], instructions: '', authority: { connectors: ['Linear'] } })
  const a = store.createAgent({ label: 'Route A', systemPrompt: 'p', tools: [], instructions: '' })
  store.runAgentProxy(b.id, { fromAgentId: a.id, capability: 'connector.read', target: 'Linear' }) // fulfilled
  store.runAgentProxy(b.id, { fromAgentId: a.id, capability: 'connector.read', target: 'Gmail' }) // denied

  const res = await call('GET', '/audit')
  assert.equal(res.status, 200)
  assert.ok(Array.isArray(res.json))
  // Newest first: the denied Gmail proxy is at the top — the detective audit watches attempts.
  assert.equal(res.json[0].channel, 'proxy')
  assert.equal(res.json[0].outcome, 'denied')
  assert.equal(res.json[0].target, 'Gmail')
  assert.equal(res.json[0].actorAgentId, b.id)
  // The earlier fulfilled proxy is in the trail as well.
  assert.ok(res.json.some((e: any) => e.outcome === 'fulfilled' && e.target === 'Linear'))
})
