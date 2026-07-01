/** Tenant-scoped sessions (design F2 / PD9 — the RLS-equivalent boundary).
 *  `createSession(msg, tenantId)` stamps the creating tenant; `listSessions(tenantId)`
 *  returns only that tenant's sessions, while seed/legacy rows (no tenantId) default to
 *  the backend's default tenant so they stay visible to the default reader on both
 *  backends; `sessionVisibleToTenant` is the route-level per-id read guard.
 *
 *  Tested at the store level here (the mock backend's default tenant is the personal
 *  one). The header-driven route boundary — GET/POST `/sessions` scoping to
 *  `store.identity(headers).tenant.id` and 404-not-403 on a cross-tenant id — is proven
 *  on the remote, multi-tenant backend in tests/capability-remote.test.ts. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from '../server/store.ts'

test('listSessions is tenant-scoped; an unscoped read spans all tenants', () => {
  const a = store.createSession('alpha thread', 'tenant-a')
  const b = store.createSession('beta thread', 'tenant-b')

  const forA = store.listSessions('tenant-a')
  const forB = store.listSessions('tenant-b')
  assert.ok(forA.some((s) => s.id === a.id) && !forA.some((s) => s.id === b.id), 'tenant-a sees only its own')
  assert.ok(forB.some((s) => s.id === b.id) && !forB.some((s) => s.id === a.id), 'tenant-b sees only its own')
  assert.ok(forA.every((s) => (s.tenantId ?? 'tenant-personal') === 'tenant-a'), 'no cross-tenant rows leak into the scoped list')

  const all = store.listSessions()
  assert.ok(all.some((s) => s.id === a.id) && all.some((s) => s.id === b.id), 'the unscoped read spans tenants')
})

test('seed/legacy sessions belong to the default tenant (visible to it, not to a stranger)', () => {
  // The mock backend's default tenant is the personal one; seed sessions carry no tenantId.
  const personal = store.listSessions('tenant-personal')
  assert.ok(personal.length > 0, 'the default tenant sees the seed sessions')
  assert.ok(personal.some((s) => s.isDemo), 'including the scripted demo')

  const stranger = store.listSessions('tenant-stranger')
  assert.ok(!stranger.some((s) => s.isDemo), 'a foreign tenant does not see the seed demo')
})

test('createSession defaults to the backend tenant, matching the scoped read', () => {
  const created = store.createSession('default-tenant thread')
  // On the mock backend that default is the personal tenant — so the default reader sees it.
  assert.ok(store.listSessions('tenant-personal').some((s) => s.id === created.id), 'lands in the default tenant')
})

test('eventVisibleToTenant gates the SSE fan-out — session/audit events are tenant-scoped, the rest global', () => {
  const owned = store.createSession('event-owner thread', 'tenant-evt')

  // session.updated carries the session → visible to its tenant, not another.
  const updated = { type: 'session.updated', session: owned } as const
  assert.equal(store.eventVisibleToTenant(updated, 'tenant-evt'), true)
  assert.equal(store.eventVisibleToTenant(updated, 'tenant-other'), false)

  // session.contexts.changed carries only the id → resolved via the session's tenant.
  const ctxChanged = { type: 'session.contexts.changed', sessionId: owned.id, contexts: [] } as const
  assert.equal(store.eventVisibleToTenant(ctxChanged, 'tenant-evt'), true)
  assert.equal(store.eventVisibleToTenant(ctxChanged, 'tenant-other'), false)
  // An unresolvable (ephemeral/removed) session id falls back to the default tenant.
  const ctxUnknown = { type: 'session.contexts.changed', sessionId: 'gone', contexts: [] } as const
  assert.equal(store.eventVisibleToTenant(ctxUnknown, 'tenant-personal'), true)
  assert.equal(store.eventVisibleToTenant(ctxUnknown, 'tenant-other'), false)

  // audit.entry carries the entry's own tenant.
  const audit = { type: 'audit.entry', entry: { id: 'ae1', tenantId: 'tenant-evt', at: 1 } } as unknown as Parameters<typeof store.eventVisibleToTenant>[0]
  assert.equal(store.eventVisibleToTenant(audit, 'tenant-evt'), true)
  assert.equal(store.eventVisibleToTenant(audit, 'tenant-other'), false)

  // Not-yet-tenant-scoped events (recents, dispatch, runners…) are global — any tenant.
  const globalEvents = [
    { type: 'recents.changed', contextType: 'files', ids: [] },
    { type: 'dispatch.changed' },
    { type: 'hello', epoch: 1 },
  ] as unknown as Parameters<typeof store.eventVisibleToTenant>[0][]
  for (const e of globalEvents) {
    assert.equal(store.eventVisibleToTenant(e, 'tenant-evt'), true)
    assert.equal(store.eventVisibleToTenant(e, 'tenant-other'), true)
  }
})

test('sessionVisibleToTenant is the per-id read guard', () => {
  const owned = store.createSession('guarded thread', 'tenant-owner')
  assert.equal(store.sessionVisibleToTenant(owned, 'tenant-owner'), true, 'owner can open it')
  assert.equal(store.sessionVisibleToTenant(owned, 'tenant-intruder'), false, 'an intruder cannot')
  // A run/seed session with no tenantId belongs to the default tenant.
  assert.equal(
    store.sessionVisibleToTenant({ id: 'srun-x', title: 'run', caps: [], preview: '' }, 'tenant-personal'),
    true,
    'an untenanted (run/seed) session belongs to the default tenant',
  )
})
