/** Agent-to-agent proxy (docs/agent-commons.md, D15) — cross-user access to a *private*
 *  resource is a request to the owner's Agent, never a credential. Pure contract: the wire
 *  shape + the channel-partition the route enforces (shared → Guardian; private → proxy). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { accessChannel, type ProxyRequest, type ProxyResult } from '../contract/index.ts'

test('accessChannel partitions shared vs private access (D15 ↔ D11 reconciliation)', () => {
  // A shared Project resource is arbitrated at the Guardian (D11), never agent-to-agent.
  assert.equal(accessChannel('shared'), 'guardian')
  // A private resource is reached only through its owner's Agent (D15).
  assert.equal(accessChannel('private'), 'agent-proxy')
})

test('a ProxyResult carries only the output — there is no credential channel (the D12 wall)', () => {
  // The request names the requester + what's asked; it never carries a B credential.
  const req: ProxyRequest = { fromAgentId: 'a-from', capability: 'connector.read', target: 'Gmail', reason: 'summarize inbox' }
  assert.equal(req.fromAgentId, 'a-from')
  // A fulfilled result returns only the output, produced by B's Agent under its own authority.
  const ok: ProxyResult = { status: 'fulfilled', actedBy: 'a-to', output: 'observed connector.read on Gmail' }
  assert.equal(ok.status, 'fulfilled')
  assert.equal(ok.actedBy, 'a-to')
  // A denied result carries a reason, no output. Neither shape has a `credential`/`token` field.
  const no: ProxyResult = { status: 'denied', actedBy: 'a-to', reason: 'owner declined' }
  assert.equal(no.output, undefined)
  assert.ok(!('credential' in no) && !('token' in no), 'no secret ever crosses the boundary')
})
