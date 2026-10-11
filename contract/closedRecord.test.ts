import test from 'node:test'
import assert from 'node:assert/strict'
import { isClosedRecord } from './closedRecord.mjs'

test('closed-record modes preserve enumerable-key and all-own-key semantics', () => {
  const enumerable = { id: 'x', value: 1 }
  Object.defineProperty(enumerable, 'hidden', { value: true })
  Object.defineProperty(enumerable, Symbol('tag'), { value: true })
  assert.equal(isClosedRecord(enumerable, ['id', 'value']), true)
  assert.equal(isClosedRecord(enumerable, ['id', 'value'], 'all'), false)

  const exact = { id: 'x', value: 1 }
  assert.equal(isClosedRecord(exact, ['id', 'value'], 'all'), true)
  assert.equal(isClosedRecord({ id: 'x', other: 1 }, ['id', 'value']), false)
  assert.equal(isClosedRecord({ id: 'x', other: 1 }, ['id', 'value'], 'all'), false)
  assert.equal(isClosedRecord({ id: 'x', value: 1, extra: true }, ['id', 'value']), false)
  assert.equal(isClosedRecord({ id: 'x' }, ['id', 'value']), false)
  assert.equal(isClosedRecord(null, []), false)
  assert.equal(isClosedRecord([], []), false)
})
