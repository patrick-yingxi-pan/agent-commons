import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseArtifactLifecycleEntries } from './artifactLifecycle.ts'

const valid = [
  ['art-1', { state: 'trashed', revision: 1, changedAt: 123 }],
  ['art-2', { state: 'active', revision: 2, changedAt: 456 }],
]

test('parseArtifactLifecycleEntries defaults absent slices and returns detached canonical rows', () => {
  assert.deepEqual(parseArtifactLifecycleEntries(undefined), [])
  assert.deepEqual(parseArtifactLifecycleEntries(valid), valid)
  const parsed = parseArtifactLifecycleEntries(valid)
  assert.notEqual(parsed[0], valid[0])
  assert.notEqual(parsed[0]?.[1], valid[0]?.[1])
})

test('parseArtifactLifecycleEntries accepts null-prototype records and trimmed opaque ids', () => {
  const value = Object.assign(Object.create(null), { state: 'trashed', revision: 1, changedAt: 0 })
  assert.deepEqual(parseArtifactLifecycleEntries([['opaque:id', value]]), [
    ['opaque:id', { state: 'trashed', revision: 1, changedAt: 0 }],
  ])
})

test('parseArtifactLifecycleEntries rejects malformed slices, entries, ids, and records', () => {
  const cases: unknown[] = [
    null,
    {},
    [['art-1']],
    [['art-1', { state: 'trashed', revision: 1 }]],
    [['art-1', { state: 'trashed', revision: 1, changedAt: 0, extra: true }]],
    [['', { state: 'trashed', revision: 1, changedAt: 0 }]],
    [[' art-1', { state: 'trashed', revision: 1, changedAt: 0 }]],
    [['art-1 ', { state: 'trashed', revision: 1, changedAt: 0 }]],
    [['art-1', { state: 'gone', revision: 1, changedAt: 0 }]],
    [['art-1', { state: 'active', revision: 0, changedAt: 0 }]],
    [['art-1', { state: 'active', revision: 1, changedAt: 0 }]],
    [['art-1', { state: 'trashed', revision: 2, changedAt: 0 }]],
    [['art-1', { state: 'trashed', revision: -1, changedAt: 0 }]],
    [['art-1', { state: 'trashed', revision: 1.5, changedAt: 0 }]],
    [['art-1', { state: 'trashed', revision: Number.MAX_SAFE_INTEGER + 1, changedAt: 0 }]],
    [['art-1', { state: 'trashed', revision: 1, changedAt: -1 }]],
    [['art-1', { state: 'trashed', revision: 1, changedAt: 0.5 }]],
    [['art-1', { state: 'trashed', revision: 1, changedAt: Number.POSITIVE_INFINITY }]],
    [['art-1', Object.assign(Object.create({ inherited: true }), { state: 'trashed', revision: 1, changedAt: 0 })]],
    [['art-1', Object.assign(Object.create(null), { state: 'trashed', revision: 1, changedAt: 0, extra: undefined })]],
    [['art-1', { state: 'trashed', revision: 1, changedAt: 0 }], ['art-1', { state: 'trashed', revision: 3, changedAt: 1 }]],
    [Object.assign(['art-1', { state: 'trashed', revision: 1, changedAt: 0 }], { extra: true })],
    [Object.assign(Object.create({ inherited: true }), ['art-1', { state: 'trashed', revision: 1, changedAt: 0 }])],
  ]
  cases.forEach((value, index) => {
    assert.throws(() => parseArtifactLifecycleEntries(value), TypeError, `malformed case ${index}`)
  })
})
