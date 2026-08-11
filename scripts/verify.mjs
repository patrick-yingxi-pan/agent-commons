#!/usr/bin/env node
/** ── The full verification sweep, in parallel ────────────────────────────────
 *
 *  `npm run verify` — typecheck, the node suite, the production build, and the
 *  browser E2E, all at once, with one pass/fail summary at the end.
 *
 *  **244s → 150s**, measured on this repo (12 cores). Every number below is a
 *  measurement, including the ones that say an idea did not work.
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
 *  **What the numbers say, including the disappointing ones.** The 178 → 135
 *  gap is not scheduling — typecheck alone is 9.9s and 57.7s while three
 *  browser stacks run, so the static checks were not waiting, they were
 *  competing. Queuing them into one lane bought 4s. Balancing the shards from
 *  Playwright's own file-order split (34/16/22) to an even 24/24/24 bought 2s,
 *  because a test count is a weak proxy for a duration and the machine is
 *  saturated either way. **150s is a CPU bound, not a coordination one**, and
 *  the next real gain is not here: it is `SectionView.tsx`, 500KB of one module
 *  that every shard's dev server compiles from scratch (Babel says so, in every
 *  run's log). Balancing stays because it removes the pathological case as the
 *  suite grows, not because it was fast.
 *
 *  What is deliberately NOT done: raising the per-shard worker count. Specs
 *  inside one stack share a store and were written expecting to be alone with
 *  it, and a suite that fails once a fortnight is worse than a slow one.
 *
 *  Output is buffered per lane and printed on completion — four interleaved
 *  live streams are unreadable. A failing lane prints its tail; the exit code
 *  is non-zero if any lane failed. `npm run verify checks` / `… e2e` runs a
 *  subset by name prefix.
 */
import { spawn } from 'node:child_process'
import { availableParallelism } from 'node:os'
import { envCount, specFiles, specGroups, suiteFiles } from './verifyPlan.mjs'

/** The plan — which suites, which specs, how they split. Its own module so a
 *  node test can hold it: these decide the sweep's COVERAGE, and this file
 *  cannot be imported to check them (it spawns children at import time). */
const SUITE = suiteFiles()

/** How many E2E processes. Three by default: the suite is I/O-bound (a browser
 *  waiting on an app), so it oversubscribes cores happily, but each shard also
 *  boots a full stack — past a handful the boots cost more than the split
 *  saves. Capped by cores so a small machine does not thrash. */
const SHARDS = Math.max(1, Math.min(envCount('E2E_SHARDS', 3, process.env, (m) => process.stdout.write(`${m}
`)), Math.floor(availableParallelism() / 2)))
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
      { cmd: 'node', args: ['--test', ...SUITE] },
      { cmd: 'npm', args: ['run', 'build'] },
    ],
  },
  ...specGroups(SHARDS).map((files, i) => ({
    name: SHARDS === 1 ? 'e2e' : `e2e ${i + 1}/${SHARDS}`,
    steps: [{ cmd: 'npx', args: ['playwright', 'test', ...files], env: { E2E_SHARD: String(i) } }],
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

process.stdout.write(`verify — ${lanes.length} lanes in parallel (${SHARDS} e2e shard${SHARDS === 1 ? '' : 's'})\n`)
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
  if (e2eLanes.length !== SHARDS) return { note, shortfall: null }
  // The SAME count `specGroups` weighs by, from the same module — not a second
  // reading of the spec files. Two independent derivations of one number can
  // agree while both are wrong about which specs exist.
  const expected = specFiles().reduce((n, f) => n + f.tests, 0)
  return { note, shortfall: total === expected ? null : `${total} of ${expected}` }
}

const wall = ((Date.now() - started) / 1000).toFixed(1)
const serial = (results.reduce((s, r) => s + r.ms, 0) / 1000).toFixed(1)
const coverage = failed.length === 0 ? e2eCoverage(results) : { note: '', shortfall: null }
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
