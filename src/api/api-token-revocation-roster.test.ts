import test from 'node:test'
import assert from 'node:assert/strict'
import type { ApiToken } from '../../contract/index.ts'
import { mergeApiTokenRevocationRoster } from './apiTokenRevocationRoster.ts'

const a: ApiToken = { id: 'token-a', label: 'A', createdAt: 1 }
const b: ApiToken = { id: 'token-b', label: 'B', createdAt: 2 }

test('token revocation reconciliation removes only the addressed row', () => {
  assert.deepEqual(mergeApiTokenRevocationRoster([a, b], a.id, undefined), [b])
})

test('token revocation reconciliation preserves unrelated arrivals and can restore its target', () => {
  const later: ApiToken = { id: 'token-later', label: 'Later', createdAt: 3 }
  const refreshed: ApiToken = { ...a, label: 'A refreshed' }
  assert.deepEqual(
    mergeApiTokenRevocationRoster([b, later], a.id, refreshed),
    [b, later, refreshed],
  )
  assert.deepEqual(
    mergeApiTokenRevocationRoster([a, b, later], a.id, refreshed),
    [refreshed, b, later],
  )
})
