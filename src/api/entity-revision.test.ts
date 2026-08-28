import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shouldAcceptEntityRevision } from './entityRevision.ts'

test('revisioned entity responses never rewind a newer cache projection', () => {
  assert.equal(shouldAcceptEntityRevision(2, 1), false)
  assert.equal(shouldAcceptEntityRevision(2, 2), true)
  assert.equal(shouldAcceptEntityRevision(2, 3), true)
})

test('legacy unrevisioned responses interoperate only until revisioned truth exists', () => {
  assert.equal(shouldAcceptEntityRevision(undefined, undefined), true)
  assert.equal(shouldAcceptEntityRevision(undefined, 0), true)
  assert.equal(shouldAcceptEntityRevision(0, undefined), false)
})
