/** ── Time budgets that mean the same thing on every machine ─────────────────
 *
 *  A spec that waits `{ timeout: 20_000 }` is not asking for twenty seconds. It
 *  is asking for "long enough that a healthy app has certainly answered, short
 *  enough that a hung one is reported" — and twenty seconds only expresses that
 *  on the machine where it was written.
 *
 *  Three failures in one afternoon on this repo were the same shape: a test
 *  that passes in 19.9s against a 20s budget when the machine is quiet, and
 *  misses when three shards compete. Nothing was broken. The suite was
 *  measuring the host, and the host had changed — a laptop on battery, a Mac
 *  with different core counts, a CI box sharing a hypervisor, or simply the
 *  sweep's own other lanes. The tax is not the re-run; it is that a suite which
 *  cries wolf teaches its readers to skip the message.
 *
 *  So budgets are written in REFERENCE milliseconds — what the number would be
 *  on the box the suite was tuned on — and `ms()` converts to local ones.
 *  Faster hosts are floored at 1× rather than tightened, because these numbers
 *  were sized for the slowest legitimate pass, not the fastest host.
 *
 *  Calibration is a few milliseconds of arithmetic at module load, once per
 *  worker process. See `scripts/hostSpeed.mjs` for what it measures and why it
 *  is a CPU loop rather than a clock or an I/O probe. */
import { resolvedFactor } from '../scripts/hostSpeed.mjs'

/** Resolved once per worker process — calling it per assertion would measure
 *  the machine hundreds of times to get the same answer. */
export const HOST_FACTOR: number = resolvedFactor()

/** A budget in reference-milliseconds, converted to this host's. */
export function ms(referenceMs: number): number {
  return Math.round(referenceMs * HOST_FACTOR)
}
