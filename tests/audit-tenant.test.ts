/** Tenant-scoped audit trail (design F2/F5, PD9 — the RLS-equivalent boundary).
 *  recordAudit stamps the effect's tenant (defaulting to the local/personal tenant);
 *  listAuditLog(tenantId) returns only that tenant's entries, while an unscoped read
 *  sees all. Tested at the store level so it doesn't depend on the (mock, single-tenant)
 *  request path — the route filters by store.identity(...).tenant.id, exercised by the
 *  existing routes-audit suite. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from '../server/store.ts'

test('listAuditLog is tenant-scoped; an unscoped read returns all tenants', () => {
  store.recordAudit({ tenantId: 'tenant-a', channel: 'proxy', actorAgentId: 'agent-1', capability: 'connector.read', target: 'alpha', outcome: 'fulfilled' })
  store.recordAudit({ tenantId: 'tenant-b', channel: 'proxy', actorAgentId: 'agent-2', capability: 'connector.read', target: 'beta', outcome: 'denied' })

  const a = store.listAuditLog('tenant-a')
  const b = store.listAuditLog('tenant-b')
  assert.ok(a.length > 0 && a.every((e) => e.tenantId === 'tenant-a'), 'tenant-a sees only its own trail')
  assert.ok(b.length > 0 && b.every((e) => e.tenantId === 'tenant-b'), 'tenant-b sees only its own trail')
  assert.ok(a.some((e) => e.target === 'alpha') && !a.some((e) => e.target === 'beta'), 'no cross-tenant leakage')

  const all = store.listAuditLog()
  assert.ok(all.some((e) => e.target === 'alpha') && all.some((e) => e.target === 'beta'), 'unscoped read spans tenants')
})

test('recordAudit defaults an unstamped effect to the local/personal tenant', () => {
  store.recordAudit({ channel: 'host-invoke', commissionId: 'c1', capability: 'fs.write', target: 'gamma', outcome: 'fulfilled' })
  const local = store.listAuditLog('tenant-personal')
  assert.ok(local.some((e) => e.target === 'gamma'), 'lands in the personal tenant by default')
})
