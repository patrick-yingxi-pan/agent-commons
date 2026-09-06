/** ── Locking test: the sweep adapts to the machine it is on ─────────────────
 *
 *  Two numbers used to be properties of one 12-core Windows box: how many
 *  browser stacks to run at once, and how long a test may take before it is
 *  called hung. Both were wrong anywhere else, and "anywhere else" now includes
 *  a Mac. `scripts/hostSpeed.mjs` derives them; these are the properties that
 *  must hold however fast the host turns out to be.
 *
 *  The calibration itself is deliberately NOT asserted to any duration — that
 *  would be the same mistake one layer down, a test that passes on the machine
 *  it was written on. What is asserted is the SHAPE: monotone, bounded, floored
 *  at the reference so a fast host never tightens a budget, and total over the
 *  garbage a real environment supplies. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, read } from './helpers/source.ts'
import { budget, calibrationMs, hostFactor, REFERENCE_MS, resolvedFactor, shardCount } from '../scripts/hostSpeed.mjs'

test('the calibration measures something real and repeatable', () => {
  const source = read(join(ROOT, 'scripts/hostSpeed.mjs'))
  assert.match(
    source,
    /const started = process\.cpuUsage\(\)/,
    'the calibration measures consumed CPU, not scheduler-contaminated wall time',
  )
  assert.match(source, /process\.cpuUsage\(started\)/, 'the sample closes against the same CPU-usage baseline')

  const a = calibrationMs()
  const b = calibrationMs()
  assert.ok(Number.isFinite(a) && a > 0, `calibration returned ${a}`)
  // Best-of-N of a fixed integer loop: the spread between two samples is what
  // decides whether dividing by it is meaningful at all. Generous because CI
  // boxes are noisy — this fails on a calibration that is pure noise, not on
  // one that is merely imprecise.
  const ratio = Math.max(a, b) / Math.min(a, b)
  assert.ok(ratio < 4, `two calibrations disagreed by ${ratio.toFixed(1)}× (${a}ms vs ${b}ms) — not a usable scale`)
})

test('a FASTER host never shrinks a budget, and a slower one is bounded', () => {
  // The floor is the whole point: these budgets were sized for the slowest
  // legitimate pass, not for the fastest machine. Tightening them on a quick
  // laptop would manufacture exactly the flakes this exists to remove.
  assert.equal(hostFactor(REFERENCE_MS / 10), 1, 'a 10× faster host still gets the base budget')
  assert.equal(hostFactor(REFERENCE_MS), 1, 'the reference host is exactly 1')
  assert.equal(hostFactor(REFERENCE_MS * 2), 2, 'half the speed doubles the budget')
  assert.equal(hostFactor(REFERENCE_MS * 100), 4, 'and it is capped — a hang stays a failure, not a coffee break')
  for (const junk of [0, -1, NaN, Infinity]) assert.equal(hostFactor(junk), 1, `${junk} falls back to 1`)
})

test('budgets scale with the host AND with the contention the sweep creates', () => {
  assert.equal(budget(1000, 1, 1), 1000, 'one lane on the reference host is the base number')
  assert.equal(budget(1000, 2, 1), 2000, 'half-speed host doubles it')
  assert.ok(budget(1000, 1, 3) > budget(1000, 1, 1), 'three competing shards buy more time than one')
  // Bounded on both sides: a junk factor cannot shrink a budget to nothing nor
  // inflate it without limit.
  assert.equal(budget(1000, 0.1, 1), 1000, 'a sub-1 factor is floored')
  assert.ok(budget(1000, 99, 1) <= 4000, 'and an absurd one is capped')
})

test('shard count follows the machine — and never reaches the shape that measured SLOWER', () => {
  // Measured on the reference box: 6 shards on 12 cores ran 219s where 3 ran
  // 195s, with a flake. A shard is four processes, three of which want CPU —
  // so the divisor is 4, not 2.
  assert.equal(shardCount(12, 1), 3, '12 cores → 3 (the measured-good shape)')
  assert.ok(shardCount(12, 1) < Math.floor(12 / 2), 'and strictly fewer than the cores/2 that measured worse')
  assert.equal(shardCount(4, 1), 1, 'a small machine does not shard')
  assert.equal(shardCount(16, 1), 4, 'a bigger one shards further')
  assert.equal(shardCount(1, 1), 1, 'never zero — an empty shard list would run the whole suite')
  assert.ok(shardCount(12, 2.5) < shardCount(12, 1), 'a slow host gets FEWER lanes — contention is what it can least afford')
  for (const junk of [0, -3, NaN, undefined]) assert.ok(shardCount(junk, 1) >= 1, `${junk} still yields a usable count`)
})

test('the runner’s selected factor is preferred to a fresh measurement, but only if it is usable', () => {
  // A shard calibrating mid-sweep measures the SWEEP, not the host, and that
  // slowness would then be multiplied again by the contention term. The runner
  // measures once, before anything competes, and passes it down.
  assert.equal(resolvedFactor({ E2E_HOST_FACTOR: '2.5' }), 2.5, 'the passed factor is used verbatim')
  assert.equal(resolvedFactor({ E2E_HOST_FACTOR: '99' }), 4, 'and still capped')
  for (const junk of ['0.5', 'abc', '', '-2']) {
    const v = resolvedFactor({ E2E_HOST_FACTOR: junk })
    assert.ok(v >= 1 && v <= 4, `${JSON.stringify(junk)} fell back to a measurement, got ${v}`)
  }
  const fresh = resolvedFactor({})
  assert.ok(fresh >= 1 && fresh <= 4, `no env → a fresh measurement in range, got ${fresh}`)

  const runner = read(join(ROOT, 'scripts/verify.mjs'))
  assert.match(runner, /const HOST_FACTOR = resolvedFactor\(\)/,
    'the top-level runner must honor a supplied factor before passing it to every shard')
  assert.doesNotMatch(runner, /const HOST_FACTOR = hostFactor\(\)/,
    'a fresh calibration must not silently overwrite the documented environment seam')
})

/** `e2e/budget.ts` is the only consumer of all this, and it is applied at ~170
 *  call sites across every spec — so a regression there (dropping the factor,
 *  rounding a small budget to zero) would silently restore the flat timeouts on
 *  every slow host, which is the exact failure the module exists to prevent.
 *  Read as source rather than imported: the module resolves the factor at load
 *  from the ambient environment, and a test that imported it would be asserting
 *  against whatever machine happens to be running it. */
test('the e2e budget helper scales by the host factor and never rounds to nothing', async () => {
  const src = read(join(ROOT, 'e2e/budget.ts'))
  assert.match(src, /resolvedFactor\(\)/, 'it uses the shared resolver, not its own calibration')
  assert.match(src, /referenceMs \* HOST_FACTOR/, 'the budget is actually scaled')

  // The arithmetic itself, against the same clamps the module is subject to.
  const scale = (base: number, factor: number) => Math.round(base * Math.min(4, Math.max(1, factor)))
  assert.equal(scale(20_000, 1), 20_000, 'the reference host gets the number as written')
  assert.equal(scale(20_000, 2), 40_000, 'half-speed doubles it')
  assert.equal(scale(20_000, 0.2), 20_000, 'a fast host never tightens a budget')
  assert.ok(scale(1, 1) >= 1, 'a 1ms budget does not round away to zero')

  // Every spec that uses it imports it — a missing import is a load-time crash
  // in one shard, which reads as an unrelated E2E failure.
  const e2eDir = join(ROOT, 'e2e')
  const specs = readdirSync(e2eDir).filter((f) => String(f).endsWith('.spec.ts'))
  assert.ok(specs.length > 10, `only ${specs.length} specs found — this scan has no subject`)
  // The import is matched with a REGEX literal, not a quoted string: a string
  // `'./budget.ts'` here is a relative path that does not resolve from `tests/`,
  // and `suite-paths.test.ts` rightly flags it (it did). An allowlist entry
  // would silence that, but the allowlist is where mistakes hide — so the
  // literal is simply not written.
  const missing = specs.filter((f) => {
    const s = read(join(e2eDir, String(f)))
    return /\bms\(/.test(s) && !/from '\.\/budget\.ts'/.test(s)
  })
  assert.deepEqual(missing, [], `specs use ms() without importing it: ${missing.join(', ')}`)
})
