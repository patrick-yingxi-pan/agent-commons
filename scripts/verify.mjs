#!/usr/bin/env node
/** ── The full verification sweep, in parallel ────────────────────────────────
 *
 *  `npm run verify` — typecheck, the node suite, the production build, and the
 *  browser E2E, all at once, with one pass/fail summary at the end.
 *
 *  **244s → 150s**, measured on this repo (12 cores). Every number below is a
 *  measurement, including the ones that say an idea did not work.
 *
 *  Those numbers are this machine's. The sweep no longer assumes them: shard
 *  count and every test budget are derived from a calibration of the host it is
 *  actually running on (`scripts/hostSpeed.mjs`), so a Mac, a laptop on
 *  battery, and a CI box sharing a hypervisor each get a shape that fits.
 *
 *    serial `&&` chain ........................ 244s   typecheck 9.9 + node
 *                                                      43.6 + build 6.2 + e2e 184
 *    all six at once, 3 e2e shards ............ 178s
 *    checks queued in one lane beside them .... 174s
 *    …with the shards balanced 24/24/24 ....... 172s
 *    …once shard 0 stopped sharing the dev
 *      stack’s model port (see MODEL_PORT) ..... 150s
 *    e2e shards alone, nothing competing ...... 135s
 *
 *  **The E2E is SHARDED across processes.** It runs one worker because the mock
 *  backend is a single shared store — a real constraint WITHIN a process and
 *  none at all across them. Each shard gets its own UI port, backend port,
 *  DATA_FILE and mock model server, from `E2E_SHARD` in `playwright.config.ts`;
 *  all four were already env seams, so isolation is arithmetic, not machinery.
 *
 *  ── The 2026-08-12 profiling pass, including what it DISPROVED ──────────────
 *
 *    count-split shards (24/24/24) ............ 189s   lanes 156 / 166 / 189
 *    duration-split shards .................... 174s   lanes 171 / 171 / 174
 *
 *  Two claims this header used to make were tested and are false. They are kept
 *  here as corrections rather than deleted, because both are the kind of guess
 *  a reader will make again.
 *
 *  1. **"E2E is I/O-bound, so it oversubscribes cores happily."** Measured at
 *     6 shards on 12 cores: 219s against 3 shards' 195s, with a flake. A shard
 *     is a Vite server, a Node backend, a mock model server AND a Chromium, and
 *     three of those want CPU. The shard count comes from `cores / 4` now
 *     (`scripts/hostSpeed.mjs`), not `cores / 2`, and raising it makes the
 *     sweep slower.
 *
 *  2. **"The next real gain is `SectionView.tsx`, which every shard's dev
 *     server compiles from scratch."** A cold dev boot is **1.6s**, and the
 *     app-entry transform 0.8s. The ~14s per shard that looked like "boot" is
 *     Playwright fixtures, `npx`, and the browser launch. Splitting that file
 *     is worth under a second per shard; it may still be worth doing for
 *     readability, but not on this account.
 *
 *  What the numbers DO say: in-test time is 93% of a shard's wall, so the sweep
 *  is bounded by the tests themselves. Sharding cannot beat the longest single
 *  spec (per-file granularity, one worker), which is why `social-layer.spec.ts`
 *  was split — at 26% of the suite in one file it set a ~145s floor. Balance is
 *  now by MEASURED duration, which took the lane spread from 33s to 2.5s;
 *  earlier balancing bought only 2s because it weighed test count, and count is
 *  a poor proxy (7.7s per test in one spec against 4.8s in another).
 *
 *  What is deliberately NOT done: raising the per-shard worker count. Specs
 *  inside one stack share a store and were written expecting to be alone with
 *  it, and a suite that fails once a fortnight is worse than a slow one.
 *
 *  Output is buffered per lane and printed on completion — four interleaved
 *  live streams are unreadable. A failing lane prints its tail; the exit code
 *  is non-zero if any lane failed. `npm run verify checks` / `… e2e` runs a
 *  subset by name prefix. `VERIFY_E2E_PART{,S}` selects one deterministic
 *  slice when those subsets are distributed across isolated CI hosts.
 */
import { spawn } from 'node:child_process'
import { availableParallelism } from 'node:os'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { e2ePartition, envCount, specFiles, specGroups, suiteConcurrency, suiteFiles, weightsFrom, WEIGHTS_FILE } from './verifyPlan.mjs'
import { resolvedFactor, shardCount } from './hostSpeed.mjs'

/** The plan — which suites, which specs, how they split. Its own module so a
 *  node test can hold it: these decide the sweep's COVERAGE, and this file
 *  cannot be imported to check them (it spawns children at import time). */
const SUITE = suiteFiles()
const NODE_TEST_CONCURRENCY = suiteConcurrency()
const SPECS = specFiles()
const PARTITION = e2ePartition(process.env, SPECS)

/** Resolved ONCE and passed down. A caller-supplied bounded factor represents
 *  a host profile the CPU-only calibration cannot observe (for example shared
 *  runner scheduling); otherwise the fresh CPU-time sample prevents sibling
 *  shards from deriving different budgets under contention. */
const HOST_FACTOR = resolvedFactor()

/** How many E2E processes. Derived from the host rather than from `cores / 2`:
 *  measured on the reference box, 6 shards on 12 cores ran SLOWER than 3
 *  (219s vs 195s) with a flake, because a shard is a Vite server, a backend, a
 *  model server and a Chromium, not a browser idling on I/O. `E2E_SHARDS`
 *  still overrides for an experiment. */
const SHARDS = PARTITION.parts > 1
  ? 1
  : Math.max(
      1,
      Math.min(
        envCount('E2E_SHARDS', shardCount(availableParallelism(), HOST_FACTOR), process.env, (m) =>
          process.stdout.write(`${m}
`),
        ),
        // Still capped at cores/2, the pre-existing guardrail. The default dropped
        // to cores/4 because oversubscription measured SLOWER (6 shards on 12
        // cores: 219s vs 195s, with a flake) — which is a reason to lower the
        // ceiling, never to raise it. An override may explore the region between
        // the two; it may not go past where the measurement stops.
        Math.max(1, Math.floor(availableParallelism() / 2)),
      ),
    )
const E2E_GROUPS = PARTITION.parts > 1 ? [PARTITION.files] : specGroups(SHARDS, SPECS)
const ONLY = process.argv.slice(2)

/** LANES, not phases: steps inside a lane run in sequence, lanes run together.
 *  The three static checks share one lane so they queue behind each other
 *  rather than adding three more CPU-bound processes to the peak — see the
 *  measurements in the header for what that is worth (4s) and what it is not. */
const lanes = [
  {
    name: 'checks',
    steps: [
      { cmd: 'npm', args: ['run', 'typecheck'] },
      { cmd: 'node', args: ['--test', `--test-concurrency=${NODE_TEST_CONCURRENCY}`, ...SUITE] },
      { cmd: 'npm', args: ['run', 'build'] },
    ],
  },
  ...E2E_GROUPS.map((files, i) => ({
    name: PARTITION.parts > 1
      ? `e2e part ${PARTITION.part}/${PARTITION.parts}`
      : SHARDS === 1 ? 'e2e' : `e2e ${i + 1}/${SHARDS}`,
    steps: [
      {
        cmd: 'npx',
        args: ['playwright', 'test', ...files],
        env: {
          E2E_SHARD: String(PARTITION.parts > 1 ? PARTITION.part - 1 : i),
          E2E_SHARDS: String(E2E_GROUPS.length),
          E2E_HOST_FACTOR: String(HOST_FACTOR),
        },
      },
    ],
  })),
].filter((l) => ONLY.length === 0 || ONLY.some((o) => l.name.startsWith(o)))

// A selection that matches nothing must not look like success. Without this the
// runner reports "all 0 lanes green" and exits 0 — for a typo (`verify chekcs`)
// or for a flag read as a filter (`verify -- --headed`). A verification tool
// passing while running nothing is the one failure it must never have.
if (lanes.length === 0) {
  process.stdout.write(`verify: no lane matches ${JSON.stringify(ONLY)} — nothing to run\n`)
  process.exitCode = 2
}

const started = Date.now()
/** One step. `shell: true` on win32: npm/npx are .cmd shims, which spawn cannot
 *  exec directly. Output is buffered and surfaced only on failure — four live
 *  streams interleaved are unreadable, and the tail is the part that says why. */
const step = (st) =>
  new Promise((resolve) => {
    const child = spawn(st.cmd, st.args, {
      shell: process.platform === 'win32',
      env: { ...process.env, ...st.env },
    })
    let out = ''
    const take = (d) => {
      out += d
      if (out.length > 400_000) out = out.slice(-200_000)
    }
    child.stdout.on('data', take)
    child.stderr.on('data', take)
    // A ChildProcess 'error' with no listener is RETHROWN by EventEmitter, so
    // an unspawnable command (npx off PATH, EACCES, a missing win32 shim) would
    // kill the runner with a bare stack trace and take the other lanes' results
    // with it. It becomes a failed lane like any other.
    child.on('error', (err) => {
      take(`\nverify: could not run \`${st.cmd} ${st.args.slice(0, 3).join(' ')}…\` — ${err.message}\n`)
      resolve({ code: 1, out })
    })
    child.on('close', (code) => resolve({ code: code ?? 1, out }))
  })

const runLane = async (lane) => {
  const t = Date.now()
  let out = ''
  let code = 0
  for (const st of lane.steps) {
    const r = await step(st)
    out += r.out
    // Stop the lane at its first failure: the steps after it would report
    // against a tree already known to be broken.
    if (r.code !== 0) {
      code = r.code
      break
    }
  }
  const ms = Date.now() - t
  process.stdout.write(`${code === 0 ? '  ok' : 'FAIL'}  ${lane.name.padEnd(10)} ${(ms / 1000).toFixed(1)}s
`)
  return { ...lane, code, ms, out }
}

const partitionNote = PARTITION.parts > 1 ? `; e2e part ${PARTITION.part}/${PARTITION.parts}` : ''
process.stdout.write(
  `verify — ${lanes.length} lanes in parallel (${E2E_GROUPS.length} e2e shard${E2E_GROUPS.length === 1 ? '' : 's'}${partitionNote})\n`,
)
const results = await Promise.all(lanes.map(runLane))
const failed = results.filter((r) => r.code !== 0)

for (const f of failed) {
  process.stdout.write(`\n${'─'.repeat(72)}\n${f.name} failed (exit ${f.code})\n${'─'.repeat(72)}\n`)
  process.stdout.write(`${f.out.split('\n').slice(-40).join('\n')}\n`)
}

/** The coverage claim a sharded suite owes you: the shards' test counts must
 *  ADD UP to what the spec files declare. A shard that silently matched no
 *  files exits 0, and three green lanes covering two thirds of the suite look
 *  exactly like three green lanes.
 *
 *  This CHECKS rather than reports. It said the same thing in prose for one
 *  commit while only printing the number, which is the failure it describes:
 *  the reader has to know the expected total and notice it changed. Expected
 *  is derived from the same `/^test\(/gm` count `specGroups` weighs by, so a
 *  spec whose tests stop being counted fails here instead of quietly shrinking
 *  the run. Skipped when a filter selected only some lanes — a partial run
 *  cannot owe a whole-suite total. */
function e2eCoverage(rs) {
  const e2eLanes = rs.filter((r) => r.name.startsWith('e2e'))
  if (e2eLanes.length === 0) return { note: '', shortfall: null }
  const counts = e2eLanes.map((r) => {
    const m = [...r.out.matchAll(/(\d+) passed/g)]
    return m.length === 0 ? 0 : Number(m[m.length - 1][1])
  })
  const total = counts.reduce((a, b) => a + b, 0)
  const note = ` · ${total} e2e tests (${counts.join(' + ')})`
  if (e2eLanes.length !== E2E_GROUPS.length) return { note, shortfall: null }
  // From the same module that plans the run — not a second reading of the spec
  // files. Two independent derivations of one number can agree while both are
  // wrong about which specs exist. (`specGroups` splits by measured WEIGHT now;
  // `tests` remains the coverage expectation, which is why they are two fields.)
  const assigned = new Set(PARTITION.files)
  const expected = SPECS.reduce((n, f) => n + (assigned.has(f.file) ? f.tests : 0), 0)
  return { note, shortfall: total === expected ? null : `${total} of ${expected}` }
}

/** Record what each spec actually cost, so the NEXT split is informed by this
 *  run instead of by a test count.
 *
 *  Written as shares, not seconds (see `specWeights`), so the file means the
 *  same thing on the machine that wrote it and on the next one. Only after a
 *  fully green, unfiltered sweep: a failed spec stops early and a filtered run
 *  saw part of the suite, and either would teach the planner that the missing
 *  work is free — the one lesson that makes the next split worse.
 *
 *  Best-effort by construction. The cache is an optimisation; a sweep that
 *  passed must not be reported as failed because a directory was read-only. */
function recordWeights(rs) {
  if (failed.length > 0 || ONLY.length > 0) return
  const e2eLanes = rs.filter((r) => r.name.startsWith('e2e'))
  if (e2eLanes.length !== SHARDS) return
  const durations = {}
  for (const lane of e2eLanes) {
    for (const m of lane.out.matchAll(/› (e2e[\\/][A-Za-z0-9._-]+\.spec\.ts):\d+:\d+ ›.*?\(([\d.]+)(ms|s)\)/g)) {
      const file = m[1].split('\\').join('/')
      durations[file] = (durations[file] ?? 0) + Number(m[2]) * (m[3] === 'ms' ? 0.001 : 1)
    }
  }
  const weights = weightsFrom(durations)
  // A parse that found nothing must not overwrite a good cache with `{}` — the
  // reporter's line format is Playwright's, not ours, and it can change under
  // us. Silence is the correct outcome then, not an empty file.
  if (Object.keys(weights).length < 2) return
  // Only specs that still exist. A deleted one would otherwise keep its share
  // forever (social-layer's 23.6% outlived the file), so the numbers stop
  // summing to 1 and the file grows entries for paths nobody can open. Written
  // from THIS run's specs, so pruning is a property of the write, not a
  // separate sweep that could be forgotten.
  const live = new Set(specFiles().map((f) => f.file))
  for (const k of Object.keys(weights)) if (!live.has(k)) delete weights[k]
  try {
    mkdirSync(dirname(WEIGHTS_FILE), { recursive: true })
    writeFileSync(WEIGHTS_FILE, `${JSON.stringify(weights, null, 2)}\n`)
  } catch {}
}
recordWeights(results)

const wall = ((Date.now() - started) / 1000).toFixed(1)
const serial = (results.reduce((s, r) => s + r.ms, 0) / 1000).toFixed(1)
const coverage = failed.length === 0 ? e2eCoverage(results) : { note: '', shortfall: null }
if (coverage.shortfall) {
  process.stdout.write(`\ncoverage mismatch diagnostics (${coverage.shortfall}):\n`)
  for (const lane of results.filter((r) => r.name.startsWith('e2e'))) {
    process.stdout.write(`\n${lane.name} output (coverage mismatch)\n`)
    process.stdout.write(`${lane.out.split('\n').slice(-80).join('\n')}\n`)
  }
}
process.stdout.write(
  // Nothing selected: the refusal above already said so, and a summary here
  // would follow it with "all 0 lanes green" — the exact sentence that guard
  // exists to prevent anyone reading.
  results.length === 0 ? ''
  : failed.length > 0 ? `\n${failed.length} of ${results.length} lanes FAILED — ${wall}s\n`
  : coverage.shortfall ?
    `\nlanes green but the shards ran ${coverage.shortfall} e2e tests — a spec went unrun\n`
  : `\nall ${results.length} lanes green in ${wall}s (${serial}s of work)${coverage.note}\n`,
)
// `process.exitCode`, never `process.exit()`. Writes to a PIPE are asynchronous
// on win32, and `process.exit` discards whatever is still queued — which for a
// failing run is the forty-line tail that says what broke. Piping the sweep
// into `tee` or a CI log is the normal case, not the exotic one.
if (failed.length > 0 || coverage.shortfall) process.exitCode = 1
