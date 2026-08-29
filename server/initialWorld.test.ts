import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveInitialWorld } from './initialWorld.ts'

test('development defaults to the authored demo while release callers can select clean', () => {
  assert.equal(resolveInitialWorld(undefined), 'demo')
  assert.equal(resolveInitialWorld(' demo '), 'demo')
  assert.equal(resolveInitialWorld('CLEAN'), 'clean')
})

test('an unknown first-boot world fails closed', () => {
  assert.throws(() => resolveInitialWorld('showcase-ish'), /INITIAL_WORLD must be demo or clean/)
})
