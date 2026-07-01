/** Tenant-scoped Agent-Commons registries (F2 / PD9) — completes the tenancy boundary.
 *  Unlike CONTENT (sessions/projects/artifacts, where a seed row is the default tenant's
 *  and private to it), a registry entry is INFRASTRUCTURE: a seeded/shared one (no tenantId
 *  — the default agent/provider/prompt every tenant needs) is visible to ALL tenants, while
 *  a *created* one is stamped with — and private to — its creator's tenant. One shared
 *  `registryVisible` predicate drives every list read. Header-driven route scoping is
 *  covered on the remote backend in tests/capability-remote.test.ts. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from '../server/store.ts'

test('created agents are tenant-private; the seeded default is shared', () => {
  const a = store.createAgent({ label: 'A-agent', systemPrompt: 'x', tools: [], instructions: '' }, 'tenant-ra')
  const b = store.createAgent({ label: 'B-agent', systemPrompt: 'x', tools: [], instructions: '' }, 'tenant-rb')
  const seeded = store.listAgents().filter((x) => x.tenantId === undefined)
  assert.ok(seeded.length > 0, 'there is a shared (seeded) default agent')

  const forA = store.listAgents('tenant-ra')
  assert.ok(forA.some((x) => x.id === a.id), 'tenant-ra sees its own agent')
  assert.ok(!forA.some((x) => x.id === b.id), 'but not the other tenant’s')
  assert.ok(seeded.every((s) => forA.some((x) => x.id === s.id)), 'the shared default is visible to tenant-ra')

  const forB = store.listAgents('tenant-rb')
  assert.ok(forB.some((x) => x.id === b.id) && !forB.some((x) => x.id === a.id))
  assert.ok(seeded.every((s) => forB.some((x) => x.id === s.id)), 'the shared default is visible to tenant-rb too')

  const all = store.listAgents() // unscoped ⇒ everything (internal use)
  assert.ok(all.some((x) => x.id === a.id) && all.some((x) => x.id === b.id))
})

test('providers, system prompts + commissions scope the same way (shared seed + private created)', () => {
  const p = store.createProvider({ label: 'P-prov', modelFamily: 'claude', effortLevels: ['Low'] }, {}, 'tenant-rp')
  assert.ok(store.listProviders('tenant-rp').some((x) => x.id === p.id), 'creator sees its provider')
  assert.ok(!store.listProviders('tenant-other').some((x) => x.id === p.id), 'another tenant does not')
  const seedProv = store.listProviders().find((x) => x.tenantId === undefined)
  assert.ok(seedProv && store.listProviders('tenant-other').some((x) => x.id === seedProv.id), 'the shared default provider is visible to all')

  const sp = store.createSystemPrompt({ label: 'P-prompt', body: 'b', targetFamily: 'claude' }, 'tenant-rp')
  assert.ok(store.listSystemPrompts('tenant-rp').some((x) => x.id === sp.id))
  assert.ok(!store.listSystemPrompts('tenant-other').some((x) => x.id === sp.id))

  const ag = store.createAgent({ label: 'C-agent', systemPrompt: 'x', tools: [], instructions: '' }, 'tenant-rp')
  const proj = store.listProjects()[0]
  const c = store.createCommission({ agentId: ag.id, projectId: proj.id }, 'tenant-rp')
  assert.ok(store.listCommissions(undefined, 'tenant-rp').some((x) => x.id === c.id), 'creator sees its commission')
  assert.ok(!store.listCommissions(undefined, 'tenant-other').some((x) => x.id === c.id), 'another tenant does not')
})
