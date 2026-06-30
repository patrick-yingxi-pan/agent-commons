/** Numeric env-var parsing (server/env.ts) — the validate-and-floor helpers that keep an
 *  empty/garbage env var (e.g. `MODEL_TIMEOUT_MS=`, `RUNNER_TTL_MS=abc`) from collapsing a
 *  tunable to a degenerate 0/NaN. Pure, so tested directly. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { positiveNumberEnv, nonNegativeIntEnv } from '../server/env.ts'

test('positiveNumberEnv: only a finite positive value overrides the fallback', () => {
  assert.equal(positiveNumberEnv('5000', 60_000), 5000)
  assert.equal(positiveNumberEnv('1.5', 1), 1.5)
  assert.equal(positiveNumberEnv(undefined, 60_000), 60_000, 'unset → fallback')
  assert.equal(positiveNumberEnv('', 60_000), 60_000, 'empty (Number("")===0) → fallback')
  assert.equal(positiveNumberEnv('abc', 60_000), 60_000, 'NaN → fallback')
  assert.equal(positiveNumberEnv('0', 60_000), 60_000, 'zero is not positive → fallback')
  assert.equal(positiveNumberEnv('-5', 60_000), 60_000, 'negative → fallback')
})

test('nonNegativeIntEnv: only a non-negative integer overrides the fallback', () => {
  assert.equal(nonNegativeIntEnv('3', 1), 3)
  assert.equal(nonNegativeIntEnv('0', 1), 0, 'zero is a legitimate "no retries"')
  assert.equal(nonNegativeIntEnv(undefined, 1), 1, 'unset → fallback')
  assert.equal(nonNegativeIntEnv('', 1), 1, 'empty → fallback')
  assert.equal(nonNegativeIntEnv('abc', 1), 1, 'NaN → fallback')
  assert.equal(nonNegativeIntEnv('2.5', 1), 1, 'non-integer → fallback')
  assert.equal(nonNegativeIntEnv('-1', 1), 1, 'negative → fallback')
})
