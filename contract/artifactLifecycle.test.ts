import assert from 'node:assert/strict'
import { test } from 'node:test'
import { nextArtifactLifecycle } from './artifactLifecycle.ts'

test('absent lifecycle is active revision zero and can be trashed once', () => {
  const result = nextArtifactLifecycle(undefined, 'trashed', 0, 123)
  assert.deepEqual(result, { kind: 'changed', value: { state: 'trashed', revision: 1, changedAt: 123 } })
})

test('trash and restore alternate parity and preserve exact retry receipts', () => {
  const trashed = nextArtifactLifecycle(undefined, 'trashed', 0, 123)
  assert.equal(trashed.kind, 'changed')
  if (trashed.kind !== 'changed') return
  const replayTrash = nextArtifactLifecycle(trashed.value, 'trashed', 0, 999)
  assert.deepEqual(replayTrash, { kind: 'replayed', value: { state: 'trashed', revision: 1, changedAt: 123 } })

  const restored = nextArtifactLifecycle(trashed.value, 'active', 1, 456)
  assert.deepEqual(restored, { kind: 'changed', value: { state: 'active', revision: 2, changedAt: 456 } })
  if (restored.kind !== 'changed') return
  const replayRestore = nextArtifactLifecycle(restored.value, 'active', 1, 999)
  assert.deepEqual(replayRestore, { kind: 'replayed', value: { state: 'active', revision: 2, changedAt: 456 } })

  const trashedAgain = nextArtifactLifecycle(restored.value, 'trashed', 2, 789)
  assert.deepEqual(trashedAgain, { kind: 'changed', value: { state: 'trashed', revision: 3, changedAt: 789 } })
})

test('same-state requests replay only the immediately preceding acknowledged revision', () => {
  assert.deepEqual(nextArtifactLifecycle({ state: 'active', revision: 0, changedAt: 0 }, 'active', 0, 10), { kind: 'conflict' })
  assert.deepEqual(nextArtifactLifecycle({ state: 'trashed', revision: 3, changedAt: 10 }, 'trashed', 1, 20), { kind: 'conflict' })
  assert.deepEqual(nextArtifactLifecycle({ state: 'trashed', revision: 3, changedAt: 10 }, 'trashed', 2, 20), {
    kind: 'replayed', value: { state: 'trashed', revision: 3, changedAt: 10 },
  })
})

test('stale, future, falsey, and overflowing revisions do not transition', () => {
  const active = { state: 'active' as const, revision: 2, changedAt: 0 }
  assert.deepEqual(nextArtifactLifecycle(active, 'trashed', 0, 5), { kind: 'conflict' })
  assert.deepEqual(nextArtifactLifecycle(active, 'trashed', 3, 5), { kind: 'conflict' })
  assert.deepEqual(nextArtifactLifecycle(active, 'trashed', Number.MAX_SAFE_INTEGER, 5), { kind: 'conflict' })
  assert.deepEqual(nextArtifactLifecycle({ state: 'active', revision: Number.MAX_SAFE_INTEGER - 1, changedAt: 0 }, 'trashed', Number.MAX_SAFE_INTEGER - 1, 5), {
    kind: 'changed', value: { state: 'trashed', revision: Number.MAX_SAFE_INTEGER, changedAt: 5 },
  })
  assert.deepEqual(nextArtifactLifecycle({ state: 'trashed', revision: Number.MAX_SAFE_INTEGER, changedAt: 5 }, 'active', Number.MAX_SAFE_INTEGER, 6), { kind: 'conflict' })
})

test('invalid current state, target, expected revision, and timestamp fail closed', () => {
  const invalid: unknown[] = [
    null,
    {},
    { state: 'active', revision: 1, changedAt: 0 },
    { state: 'trashed', revision: 2, changedAt: 0 },
    { state: 'active', revision: 0, changedAt: -1 },
    { state: 'active', revision: 0, changedAt: 0, extra: true },
    Object.assign(Object.create({ inherited: true }), { state: 'active', revision: 0, changedAt: 0 }),
  ]
  for (const value of invalid) {
    assert.deepEqual(nextArtifactLifecycle(value as never, 'trashed', 0, 1), { kind: 'invalid' })
  }
  assert.deepEqual(nextArtifactLifecycle(undefined, 'gone' as never, 0, 1), { kind: 'invalid' })
  for (const revision of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, null]) {
    assert.deepEqual(nextArtifactLifecycle(undefined, 'trashed', revision as never, 1), { kind: 'invalid' })
  }
  for (const now of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, null]) {
    assert.deepEqual(nextArtifactLifecycle(undefined, 'trashed', 0, now as never), { kind: 'invalid' })
  }
})

test('transition results are detached from mutable input state', () => {
  const input = { state: 'trashed' as const, revision: 1, changedAt: 123 }
  const result = nextArtifactLifecycle(input, 'active', 1, 456)
  assert.equal(result.kind, 'changed')
  if (result.kind === 'changed') result.value.changedAt = 999
  assert.equal(input.changedAt, 123)
})
