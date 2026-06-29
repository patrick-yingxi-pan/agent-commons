/** Detective audit contract (docs/agent-commons.md, D15/OQ7) — the pure record + its
 *  one-line summary. The store + route behaviour lands in Phase 6.2/6.3; this locks the
 *  channel union and the summary shape (each channel, both outcomes). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AUDIT_CHANNELS, AUDIT_CHANNEL_LABEL, summarizeAudit, type AuditEntry } from '../contract/audit.ts'

test('AUDIT_CHANNELS names the three cross-user channels, each with a label', () => {
  assert.deepEqual([...AUDIT_CHANNELS], ['proxy', 'project-effect', 'host-invoke'])
  for (const ch of AUDIT_CHANNELS) assert.ok(AUDIT_CHANNEL_LABEL[ch].length > 0, `${ch} has a label`)
})

test('summarizeAudit: names the actor (Agent or Commission), outcome, capability, target', () => {
  const proxy: AuditEntry = {
    id: 'a1', channel: 'proxy', actorAgentId: 'agent-7', capability: 'connector.read', target: 'Linear', outcome: 'fulfilled', at: 1,
  }
  const s = summarizeAudit(proxy)
  assert.match(s, /agent-to-agent proxy/)
  assert.match(s, /agent-7 fulfilled connector\.read on 'Linear'/)

  // A denied effect is recorded too (detective audit watches attempts).
  const denied: AuditEntry = { ...proxy, id: 'a2', target: 'Gmail', outcome: 'denied' }
  assert.match(summarizeAudit(denied), /denied connector\.read on 'Gmail'/)

  // A commission-attributed channel falls back to the commission id as the actor.
  const effect: AuditEntry = {
    id: 'a3', channel: 'project-effect', commissionId: 'commission-3', capability: 'connector.write', target: 'Figma', outcome: 'fulfilled', at: 2,
  }
  assert.match(summarizeAudit(effect), /Project effect: commission-3 fulfilled/)
})
