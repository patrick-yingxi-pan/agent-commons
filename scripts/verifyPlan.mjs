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

/** Every browser spec file with the number of tests it declares.
 *
 *  The count is the sharding WEIGHT and the coverage EXPECTATION, deliberately
 *  the same number from the same regex: if a spec stops being counted, the
 *  expectation drops with it and the shortfall check below cannot notice — so
 *  they must not be two independent guesses at the same fact. */
export function specFiles(dir = 'e2e') {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.spec.ts'))
    .map((f) => ({
      file: `${dir}/${f}`,
      tests: (readFileSync(`${dir}/${f}`, 'utf8').match(/^test\(/gm) ?? []).length,
    }))
    .sort((a, b) => b.tests - a.tests || a.file.localeCompare(b.file))
}

/** Spec files split into groups of roughly equal weight — heaviest first into
 *  whichever group is currently lightest.
 *
 *  Playwright's own `--shard=i/n` splits by file in declaration order, which put
 *  34 of the 72 tests in one lane and 16 in another; the suite then waits on the
 *  unlucky lane. Test count is a rough proxy for duration (one co-authoring walk
 *  outlasts five rail checks) but it is free and it removes the bad case.
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
    // A file with no matched tests still costs a browser and a stack boot, so
    // it weighs at least one — otherwise every such file piles into one group.
    lightest.weight += Math.max(1, f.tests)
  }
  return groups.map((g) => g.files)
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
