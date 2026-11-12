/** ── What `npm run verify` is going to run ───────────────────────────────────
 *
 *  The planning half of `scripts/verify.mjs`, split out for one reason: these
 *  three functions decide the sweep's COVERAGE — which node suites run, which
 *  spec files run, and how many shards there are — and the runner itself does
 *  its work at import time (it spawns children under a top-level await), so
 *  nothing could import it to check them. A bug in here subtracts tests from
 *  the sweep without failing anything, which is the one defect a verification
 *  tool must not have.
 *
 *  Pure, filesystem-in / plan-out, and locked by `tests/verify-plan.test.ts`.
 */
import { readdirSync, readFileSync } from 'node:fs'

/** Node's test-runner worker count, derived from the one authoritative `npm
 * test` script. Keep it bounded: too many concurrent suites contend for the
 * same local profile and external helper resources, while an unbounded setting
 * can make a verification run less reliable on larger hosts. */
export function suiteConcurrency(pkgPath = 'package.json') {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  const script = pkg?.scripts?.test
  if (typeof script !== 'string') throw new Error('missing string `test` script in package.json')
  const options = [...script.matchAll(/(?:^|\s)(--test-concurrency[^\s]*)/g)].map((m) => m[1])
  if (options.length !== 1) {
    throw new Error(`expected exactly one --test-concurrency option in the \`test\` script; found ${options.length}`)
  }
  const match = options[0].match(/^--test-concurrency=(\d+)$/)
  if (!match) throw new Error(`malformed --test-concurrency option in the \`test\` script: ${options[0]}`)
  const count = Number(match[1])
  if (!Number.isSafeInteger(count) || count < 1 || count > 16) {
    throw new Error(`--test-concurrency must be a positive safe integer no greater than 16; got ${match[1]}`)
  }
  return count
}

/** The roots `npm test` globs — read OUT OF the script that globs them.
 *
 *  Since the suites moved next to the code they lock, the set of roots is
 *  itself something that can drift: a layer whose tests colocate but whose root
 *  never reaches this list runs nowhere, and the lane still goes green over
 *  fewer tests — the same silent-subtraction defect the recursion below exists
 *  to prevent, one level up. Deriving the roots from `package.json` makes it
 *  unrepresentable: there is one list, and the runner reads the one the package
 *  script uses. */
export function suiteRoots(pkgPath = 'package.json') {
  const script = JSON.parse(readFileSync(pkgPath, 'utf8')).scripts.test
  const roots = [...script.matchAll(/"([^"*]+)\/\*\*\/\*\.test\.ts"/g)].map((m) => m[1])
  if (!roots.length) throw new Error('no recursive suite globs in the `test` script: ' + script)
  return roots
}

/** Top-level directories that actually CONTAIN suites, found by looking.
 *
 *  The counterpart `suiteRoots` needs and did not have. Reading the roots out
 *  of `package.json` gives one source of truth for *which* roots run, but says
 *  nothing about whether that set covers the suites on disk — and deleting one
 *  glob removes an entire layer from every run while every check stays green
 *  (measured: dropping `src/**` hid 70 suites and all six guards passed). The
 *  second net degraded with the first, because it derived its subject from the
 *  same roots. So coverage has to be asked of the FILESYSTEM, not of the list
 *  being checked. */
export function suiteDirs(root = '.') {
  const skip = new Set(['node_modules', 'dist', '.git', '.data', 'test-results', '.claude'])
  const found = new Set()
  for (const top of readdirSync(root, { withFileTypes: true })) {
    if (!top.isDirectory() || skip.has(top.name)) continue
    // `.tsx` too: the npm glob runs both, so a directory holding only `.test.tsx`
    // must still be reported as needing a glob rather than reading as suite-free.
    const hit = readdirSync(`${root}/${top.name}`, { recursive: true }).some((f) =>
      /\.test\.tsx?$/.test(String(f).split('\\').join('/')),
    )
    if (hit) found.add(top.name)
  }
  return [...found].sort()
}

/** Every node suite file under every root, RECURSIVELY.
 *
 *  Recursive because `package.json`'s `test` script is a recursive glob, and
 *  two enumerations of one thing drift: a flat readdir agrees today and stops
 *  agreeing the first time a suite lands in a subdirectory — silently, since
 *  the lane still goes green, just over fewer tests. Separators are normalised
 *  because `recursive: true` yields win32 backslashes for nested entries. */
export function suiteFiles(dirs = suiteRoots()) {
  return (Array.isArray(dirs) ? dirs : [dirs])
    .flatMap((dir) =>
      readdirSync(dir, { recursive: true })
        .map((f) => String(f).split('\\').join('/'))
        .filter((f) => f.endsWith('.test.ts'))
        .map((f) => `${dir}/${f}`),
    )
    .sort()
}

/** Keep the exact manifest while bounding Windows process arguments. The full
 * suite now exceeds CreateProcess's 32,767-character limit. Reserve ample space
 * for the executable/options and conservatively allow every path character to
 * double during Windows quoting. Batches run sequentially in the checks lane,
 * so the npm-owned concurrency remains the total Node worker limit. */
export function suiteBatches(files, platform = process.platform) {
  if (files.length === 0) throw new Error('cannot run an empty Node suite manifest')
  if (platform !== 'win32') return [files]
  const budget = 6_000
  const batches = []
  let batch = []
  let size = 0
  for (const file of files) {
    const cost = file.length * 2 + 3
    if (cost > budget) throw new Error(`Node suite path exceeds the Windows command-line argument budget: ${file}`)
    if (size + cost > budget) {
      batches.push(batch)
      batch = []
      size = 0
    }
    batch.push(file)
    size += cost
  }
  batches.push(batch)
  return batches
}

/** Where the runner records how long each spec actually took, as a SHARE of the
 *  run rather than in seconds.
 *
 *  A share is host-independent: `social-layer` was 26% of the E2E work on the
 *  reference box and will be about 26% on a Mac, because both machines run the
 *  same browser over the same app. Seconds would have to be re-measured per
 *  host and would be wrong the first time anyone ran the sweep somewhere new.
 *
 *  Gitignored (`.data/`), so a fresh clone simply has no cache and falls back
 *  to test count — the file is an optimisation, never a source of truth, and
 *  nothing fails because it is missing, stale, or corrupt. */
export const WEIGHTS_FILE = '.data/spec-weights.json'

/** Memoised default-path read — see `specWeights`. */
let cachedWeights = null

/** The recorded shares, or `{}` if there are none to be had. Deliberately total:
 *  a half-written or hand-edited cache degrades the SPLIT, which costs seconds,
 *  and must never take down the sweep, which costs the whole run. */
export function specWeights(file = WEIGHTS_FILE) {
  if (file === WEIGHTS_FILE && cachedWeights) return cachedWeights
  let out = {}
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    for (const [k, v] of Object.entries(raw ?? {})) if (Number.isFinite(v) && v > 0) out[k] = v
  } catch {
    out = {}
  }
  // Memoised for the default path only: `specFiles`' default parameter is
  // evaluated per CALL, and the planner asks several times per run (through
  // specGroups, and again for the coverage total) — re-reading and re-parsing
  // the same JSON each time is I/O inside a function that advertises itself as
  // a pure plan. An explicit path is never memoised, so tests keep passing
  // fixtures without poisoning the cache for each other.
  if (file === WEIGHTS_FILE) cachedWeights = out
  return out
}

/** Every browser spec file with the number of tests it declares AND the weight
 *  to shard it by.
 *
 *  The count is the coverage EXPECTATION, from the same regex the shortfall
 *  check uses: two independent guesses at one fact drift, and the one that
 *  drifts silently subtracts tests. It was ALSO the sharding weight, and there
 *  it was simply wrong — `social-layer` runs 7.7s per test and `main-split`
 *  4.8s, so an even 24/24/24 split by count produced 179/141/182 seconds and
 *  left the fastest lane idle for 40s of every sweep.
 *
 *  So the two facts are now separate: `tests` still expects, `weight` now
 *  splits. Weight is the recorded share when there is one and the test count's
 *  own share otherwise — a new spec is estimated from its size until the first
 *  run measures it, and a repo with no cache behaves exactly as before. */
export function specFiles(dir = 'e2e', weights = specWeights()) {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.spec.ts'))
    .map((f) => ({
      file: `${dir}/${f}`,
      tests: (readFileSync(`${dir}/${f}`, 'utf8').match(/^test\(/gm) ?? []).length,
    }))
  const totalTests = files.reduce((n, f) => n + f.tests, 0) || 1
  return files
    .map((f) => ({ ...f, weight: weights[f.file] ?? f.tests / totalTests }))
    .sort((a, b) => b.weight - a.weight || a.file.localeCompare(b.file))
}

/** Per-spec shares, from durations the runner observed. Normalised so the
 *  result is a share of the run and not a record of how busy the machine was. */
export function weightsFrom(durations) {
  const total = Object.values(durations).reduce((n, v) => n + (v > 0 ? v : 0), 0)
  if (!(total > 0)) return {}
  const out = {}
  for (const [file, v] of Object.entries(durations)) if (v > 0) out[file] = v / total
  return out
}

/** Spec files split into groups of roughly equal weight — heaviest first into
 *  whichever group is currently lightest.
 *
 *  Playwright's own `--shard=i/n` splits by file in declaration order, which put
 *  34 of the 72 tests in one lane and 16 in another; the suite then waits on the
 *  unlucky lane. Test COUNT replaced that and removed the pathological case,
 *  but it is a weak proxy — measured, an even 24/24/24 by count ran
 *  179/141/182 seconds — so the weight is now the recorded share of runtime
 *  where one exists (see `specWeights`), falling back to count.
 *
 *  **What this cannot fix.** Sharding is per FILE and each shard runs one
 *  worker, so a lane can never be shorter than its longest single spec. With
 *  `social-layer.spec.ts` at 26% of the suite, no split beat ~145s however many
 *  shards were thrown at it; splitting the FILE is what moves that floor, and
 *  the balance here only stops the other lanes idling while it runs.
 *
 *  **Never more groups than files.** An empty group would reach
 *  `playwright test` with no path arguments, and that runs the WHOLE suite — so
 *  the shape that looks like "this shard has nothing to do" is the shape that
 *  silently does everything, once per empty shard. Reachable for real: `SHARDS`
 *  is capped at half the core count, which on a 48-core machine exceeds the
 *  number of spec files. */
export function specGroups(n, files = specFiles()) {
  const groups = Array.from({ length: Math.max(1, Math.min(n, files.length)) }, () => ({ files: [], weight: 0 }))
  for (const f of files) {
    const lightest = groups.reduce((a, b) => (b.weight < a.weight ? b : a))
    lightest.files.push(f.file)
    // A file that measured (or counted) as nothing still costs a browser and a
    // stack boot, so it weighs a floor — otherwise every such file piles into
    // one group. The floor is a share, matching the units `weight` is now in.
    lightest.weight += Math.max(f.weight ?? 0, 0.001)
  }
  return groups.map((g) => g.files)
}

/** One externally distributed slice of the E2E manifest.
 *
 *  Local sharding means several stacks compete on ONE host. CI partitioning
 *  means one stack on EACH host, so it needs a separate seam: pretending those
 *  are the same knob either oversubscribes a small runner or leaves its one
 *  process with the whole suite. Both variables are required together and
 *  fail closed; a typo must not turn two intended halves into two full runs. */
export function e2ePartition(env = process.env, files = specFiles()) {
  const rawParts = env.VERIFY_E2E_PARTS
  const rawPart = env.VERIFY_E2E_PART
  if (rawParts === undefined && rawPart === undefined) {
    return { part: 1, parts: 1, files: files.map((f) => f.file) }
  }
  if (rawParts === undefined || rawPart === undefined) {
    throw new Error('VERIFY_E2E_PARTS and VERIFY_E2E_PART must be supplied together')
  }

  const parts = Number(rawParts)
  const part = Number(rawPart)
  if (!Number.isInteger(parts) || parts < 1 || !Number.isInteger(part) || part < 1 || part > parts) {
    throw new Error(`invalid E2E partition ${JSON.stringify(rawPart)}/${JSON.stringify(rawParts)}`)
  }
  if (parts > files.length) {
    throw new Error(`E2E partition count ${parts} exceeds the ${files.length} spec files`)
  }
  return { part, parts, files: specGroups(parts, files)[part - 1] }
}

/** A positive integer from the environment, or the fallback.
 *
 *  `Number('two')` is NaN, and NaN survives `Math.max`/`Math.min` unchanged — it
 *  used to reach `Array.from({length: NaN})` and die in an empty-array `reduce`,
 *  several frames from the typo that caused it. */
export function envCount(name, fallback, env = process.env, warn = () => {}) {
  const raw = env[name]
  if (raw === undefined || raw === '') return fallback
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1) {
    warn(`verify: ignoring ${name}=${JSON.stringify(raw)} — not a positive integer`)
    return fallback
  }
  return n
}
