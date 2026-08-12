/** ── How fast is THIS machine? ───────────────────────────────────────────────
 *
 *  The sweep was tuned on one 12-core Windows box and hard-coded two numbers
 *  that are really properties of that box: how many browser stacks to run at
 *  once, and how long a test may take before it is declared hung. Both are
 *  wrong somewhere else — and "somewhere else" now includes a Mac.
 *
 *  Two failures this exists to prevent, both observed here:
 *
 *  1. **Shard count as a guess.** The runner took `cores / 2`, on the premise
 *     (stated in verify.mjs) that E2E is I/O-bound and oversubscribes cores
 *     happily. Measured at 6 shards on 12 cores: the sweep got SLOWER, 195s →
 *     219s, and one shard flaked. A shard is not a browser waiting on an app —
 *     it is a Vite dev server, a Node backend, a mock model server AND a
 *     Chromium, and four of those want CPU. `cores / 4` matches what was
 *     measured; see `shardCount`.
 *
 *  2. **Timeouts as absolutes.** Three E2E failures in one afternoon were all
 *     the same shape: a test that passes in 19.9s against a 20s budget when the
 *     machine is quiet, and misses it when three stacks compete. That is not a
 *     bug in the test, and a suite that fails on a slower laptop teaches people
 *     to re-run rather than to read. Budgets scale with the machine.
 *
 *  The calibration is a fixed integer loop, not a wall-clock sleep or an I/O
 *  probe: it measures the thing that actually varies between hosts and under
 *  contention (available CPU), it costs single-digit milliseconds, and it needs
 *  no network, no disk and no state. Pure and deterministic in shape, so a node
 *  test can pin its properties — `tests/host-speed.test.ts`.
 */

/** Iterations chosen so the loop takes ~5–15ms on a modern core: long enough to
 *  clear timer granularity, short enough that paying it at config load is free. */
const CALIBRATION_ITERATIONS = 4_000_000

/** The reference machine: the 12-core Windows box every timing in
 *  `verify.mjs`'s header was measured on, calibrated at **15.2ms** (best-of-5,
 *  eight samples, 1.17× spread — stable enough to divide by).
 *
 *  A factor of 1 means "as fast as that"; 2 means half the speed, and every
 *  budget doubles. Recorded as a measured constant rather than re-derived at
 *  runtime, because a moving reference makes every past measurement in that
 *  header unreadable — and re-deriving it on a busy machine would quietly
 *  redefine "normal" as "whatever today is". */
export const REFERENCE_MS = 15.2

/** Milliseconds for the calibration loop on this host, right now.
 *
 *  Best-of-N, not a mean: the minimum is the closest thing to "what this
 *  machine can do", while a mean is dragged around by whatever else is
 *  running — and a budget that inflates because a build happened to be running
 *  during calibration would hide the very slowness it is meant to absorb. */
export function calibrationMs(rounds = 3, iterations = CALIBRATION_ITERATIONS) {
  let best = Infinity
  for (let r = 0; r < rounds; r++) {
    const t = process.hrtime.bigint()
    // Data-dependent arithmetic so the optimiser cannot lift it out of the loop.
    let acc = 0
    for (let i = 1; i <= iterations; i++) acc = (acc + (i % 7) * (i % 13)) % 1_000_003
    const ms = Number(process.hrtime.bigint() - t) / 1e6
    if (acc === -1) throw new Error('unreachable — keeps `acc` live')
    if (ms < best) best = ms
  }
  return best
}

/** How much slower than the reference machine, clamped to [1, 4].
 *
 *  Floored at 1 so a FASTER machine never SHRINKS a budget: the timeouts are
 *  sized for the slowest legitimate test, not for the fastest host, and cutting
 *  them on a quick laptop would manufacture flakes rather than remove them.
 *  Capped at 4 because past that the honest answer is that something is wrong
 *  with the machine, and a 2-minute per-test budget turns a hang into a coffee
 *  break instead of a failure. */
export function hostFactor(ms = calibrationMs()) {
  if (!Number.isFinite(ms) || ms <= 0) return 1
  return Math.min(4, Math.max(1, ms / REFERENCE_MS))
}

/** How many E2E shards this host should run.
 *
 *  `cores / 4`, floor 1, because each shard is FOUR processes and at least
 *  three of them want CPU. Measured on the reference box: 3 shards 195s, 6
 *  shards 219s with a flake — oversubscribing does not trade latency for
 *  throughput here, it loses both. A slow host additionally gets fewer shards:
 *  contention is exactly what it can least afford. */
export function shardCount(cores, factor = 1) {
  const byCores = Math.floor((Number.isFinite(cores) && cores > 0 ? cores : 4) / 4)
  const slowPenalty = factor >= 2 ? 1 : 0
  return Math.max(1, byCores - slowPenalty)
}

/** The host factor to USE — the runner's measurement if it made one, else a
 *  fresh one.
 *
 *  Measuring inside each shard would measure the sweep, not the machine: by
 *  then two sibling stacks are compiling, so the loop reads slow, and that
 *  slowness is then multiplied AGAIN by the contention term below. The runner
 *  calibrates once before it launches anything and passes the number down, so
 *  the two factors stay what they claim to be — one about the host, one about
 *  the load the sweep adds. A direct `npx playwright test` has no runner, so it
 *  measures for itself and its contention term is 1. */
export function resolvedFactor(env = process.env) {
  const passed = Number(env.E2E_HOST_FACTOR)
  if (Number.isFinite(passed) && passed >= 1) return Math.min(4, passed)
  return hostFactor()
}

/** A budget in ms, scaled for this host and for the contention the sweep itself
 *  creates. Shards compete, so N shards is a real slowdown the base number was
 *  never measured against.
 *
 *  Bounded on purpose: the product of a 4× host factor and the contention term
 *  is the worst a budget can grow, so a pathological calibration inflates a
 *  hang into a long wait, never into a run that never ends. */
export function budget(baseMs, factor = 1, shards = 1) {
  const contention = 1 + Math.max(0, shards - 1) * 0.25
  return Math.round(baseMs * Math.min(4, Math.max(1, factor)) * contention)
}
