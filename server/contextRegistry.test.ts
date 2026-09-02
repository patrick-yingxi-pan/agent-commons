import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { RecentsSnapshot, SavedContext } from '../contract/index.ts'
import { createContextRegistry } from './contextRegistry.ts'
import { ConflictError } from './conflict.ts'
import { SAVED_CONTEXTS } from './data/savedContexts.ts'

const recents = (repo: string): RecentsSnapshot => ({
  files: [], photos: [], folder: [], repo: [repo], connector: [], mcp: [],
})
const seed: SavedContext = {
  id: 'seed', label: 'Seed', kind: 'connector', status: 'connected', detail: 'seed', lastUsedAt: null, sessions: 0,
}
const custom = (id: string): SavedContext => ({
  id, label: id, kind: 'connector', status: 'connected', detail: id, lastUsedAt: null, sessions: 0,
})

test('saved contexts are server-stamped, tenant-isolated, and existence-hiding on mutation', () => {
  const registry = createContextRegistry({ seedContexts: [seed], seedRecents: recents('seed-repo'), defaultTenantId: () => 'tenant-a' })

  assert.deepEqual(registry.snapshot('tenant-a').contexts.map((context) => context.id), ['seed'])
  assert.deepEqual(registry.snapshot('tenant-b').contexts, [], 'an unstamped seed belongs only to the default tenant')

  const input = { ...custom('same-id'), tenantId: 'tenant-b' } as SavedContext
  const addedA = registry.add(input, 'tenant-a').context
  assert.equal('tenantId' in addedA, false, 'server ownership is not reflected from caller JSON or exposed on the public face')
  assert.equal(addedA.connectionRevision, 0, 'caller ordering is ignored; a server row begins at zero')
  registry.add(custom('same-id'), 'tenant-b')
  assert.ok(registry.snapshot('tenant-a').contexts.some((context) => context.id === 'same-id'))
  assert.ok(registry.snapshot('tenant-b').contexts.some((context) => context.id === 'same-id'))

  registry.setStatus('same-id', 'needs-auth', 'tenant-a', 0)
  assert.equal(registry.snapshot('tenant-a').contexts.find((context) => context.id === 'same-id')?.status, 'needs-auth')
  assert.equal(registry.snapshot('tenant-a').contexts.find((context) => context.id === 'same-id')?.connectionRevision, 1)
  assert.equal(registry.snapshot('tenant-b').contexts.find((context) => context.id === 'same-id')?.status, 'connected')
  assert.throws(
    () => registry.setStatus('same-id', 'connected', 'tenant-a', 0),
    ConflictError,
    'a stale transition changes nothing',
  )
  const converged = registry.setStatus('same-id', 'needs-auth', 'tenant-a', 0)
  assert.equal(converged?.changed, false, 'a lost-ack replay already at its desired state is a no-op success')
  assert.equal(registry.snapshot('tenant-a').contexts.find((context) => context.id === 'same-id')?.connectionRevision, 1)
  assert.equal(registry.setStatus('seed', 'needs-auth', 'tenant-b'), undefined, 'foreign and unknown mutation share one absence face')
  assert.equal(registry.remove('same-id', 'tenant-a'), true)
  assert.equal(registry.snapshot('tenant-b').contexts.some((context) => context.id === 'same-id'), true)
})

test('saved Context descriptions stay orthogonal to live connection status', () => {
  for (const context of SAVED_CONTEXTS.filter((candidate) => candidate.kind !== 'repo')) {
    assert.doesNotMatch(
      context.detail,
      /\b(?:connected|needs auth(?:entication)?|token expired|reconnect|finish setup)\b|DATABASE_URL/i,
      `${context.id} description must not become stale when its connection status changes`,
    )
  }
})

test('recents are isolated, cloned at the boundary, and round-trip with legacy default state', () => {
  const registry = createContextRegistry({ seedContexts: [], seedRecents: recents('seed-repo'), defaultTenantId: () => 'tenant-a' })
  const a = registry.pushRecent('repo', 'a-only', 'tenant-a')
  const b = registry.pushRecent('repo', 'b-only', 'tenant-b')
  a.repo.push('caller-mutation')
  b.repo.push('caller-mutation')
  assert.deepEqual(registry.recents('tenant-a').repo, ['a-only', 'seed-repo'])
  assert.deepEqual(registry.recents('tenant-b').repo, ['b-only'])

  const persisted = registry.persistedRecents()
  const restored = createContextRegistry({ seedContexts: [], seedRecents: recents('wrong'), defaultTenantId: () => 'tenant-a' })
  restored.rehydrate({ defaultRecents: persisted.defaultRecents, tenantRecents: persisted.tenantRecents })
  assert.deepEqual(restored.recents('tenant-a').repo, ['a-only', 'seed-repo'])
  assert.deepEqual(restored.recents('tenant-b').repo, ['b-only'])
})
