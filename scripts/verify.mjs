#!/usr/bin/env node
/** ── The full verification sweep, in parallel ────────────────────────────────
 *
 *  `npm run verify` — typecheck, the node suite, the production build, and the
 *  browser E2E, all at once, with one pass/fail summary at the end.
 *
 *  **244s → 172s**, measured on this repo (12 cores). Every number below is a
 *  measurement, including the ones that say an idea did not work.
 *
 *    serial `&&` chain ........................ 244s   typecheck 9.9 + node
 *                                                      43.6 + build 6.2 + e2e 184
 *    all six at once, 3 e2e shards ............ 178s
 *    checks queued in one lane beside them .... 174s
 *    …with the shards balanced 24/24/24 ....... 172s
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
 *  saturated either way. **172s is a CPU bound, not a coordination one**, and
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
import { readdirSync, readFileSync } from 'node:fs'
import { availableParallelism } from 'node:os'

/** The suite files, enumerated HERE rather than passed as `tests/*.test.ts`.
 *  Two reasons, both load-bearing on this host: `spawn` with `shell: true` runs
 *  cmd.exe on win32, which does not expand globs, and handing `node --test` the
 *  DIRECTORY instead makes it walk the whole tree and pick up files that are not
 *  the suite. The first cut did exactly that and the phase failed with one
 *  nameless "test failed". */
const SUITE = readdirSync('tests')
  .filter((f) => f.endsWith('.test.ts'))
  .map((f) => `tests/${f}`)

/** Spec files split into `n` groups of roughly equal WEIGHT, heaviest first into
 *  whichever group is currently lightest.
 *
 *  Playwright's own `--shard=i/n` splits by file in declaration order, which put
 *  34 of the 72 tests in one lane and 16 in another — the whole suite then waits
 *  on the unlucky lane. Weight is the file's test count, a proxy for its
 *  duration and a rough one (a single co-authoring walk outlasts five rail
 *  checks), but it is free and it fixes the bad case.
 *
 *  Computed rather than listed. A hand-written grouping is a file every new spec
 *  has to be added to, and forgetting is SILENT — the spec simply never runs.
 *  Here a new file joins a group by existing. The count printed at the end is
 *  the receipt: if the groups ever stop covering the suite, the total stops
 *  matching. */
function specGroups(n) {
  const weighed = readdirSync('e2e')
    .filter((f) => f.endsWith('.spec.ts'))
    .map((f) => ({
      file: `e2e/${f}`,
      tests: (readFileSync(`e2e/${f}`, 'utf8').match(/^test\(/gm) ?? []).length || 1,
    }))
    .sort((a, b) => b.tests - a.tests)
  const groups = Array.from({ length: n }, () => ({ files: [], weight: 0 }))
  for (const w of weighed) {
    const lightest = groups.reduce((a, b) => (b.weight < a.weight ? b : a))
    lightest.files.push(w.file)
    lightest.weight += w.tests
  }
  return groups.map((g) => g.files)
}

/** How many E2E processes. Three by default: the suite is I/O-bound (a browser
 *  waiting on an app), so it oversubscribes cores happily, but each shard also
 *  boots a full stack — past a handful the boots cost more than the split
 *  saves. Capped by cores so a small machine does not thrash. */
const SHARDS = Math.max(1, Math.min(Number(process.env.E2E_SHARDS ?? 3), Math.floor(availableParallelism() / 2)))
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
    child.on('close', (code) => resolve({ code, out }))
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
 *  ADD UP. A shard that silently matched no files exits 0, and three green
 *  lanes covering two thirds of the suite look exactly like three green lanes.
 *  Parsed from playwright's own summary rather than assumed. */
function e2eCoverage(rs) {
  const lanes = rs.filter((r) => r.name.startsWith('e2e'))
  if (lanes.length === 0) return ''
  const counts = lanes.map((r) => {
    const m = [...r.out.matchAll(/(\d+) passed/g)]
    return m.length === 0 ? 0 : Number(m[m.length - 1][1])
  })
  const total = counts.reduce((a, b) => a + b, 0)
  return ` · ${total} e2e tests (${counts.join(' + ')})`
}

const wall = ((Date.now() - started) / 1000).toFixed(1)
const serial = (results.reduce((s, r) => s + r.ms, 0) / 1000).toFixed(1)
process.stdout.write(
  failed.length === 0 ?
    `\nall ${results.length} lanes green in ${wall}s (${serial}s of work)${e2eCoverage(results)}\n`
  : `\n${failed.length} of ${results.length} lanes FAILED — ${wall}s\n`,
)
process.exit(failed.length === 0 ? 0 : 1)
