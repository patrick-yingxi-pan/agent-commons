/** ── Locking test: a suite's paths survive the suite MOVING ─────────────────
 *
 *  Earned, twice over, by the colocation passes that put every suite next to
 *  the code it locks (2026-08-12). Moving 222 files rewrote their import
 *  specifiers correctly — a resolver did that, and it cannot be fooled. What it
 *  could not see were the OTHER ways a suite names a file, and each of them
 *  failed in the worst way available: not at load, where a bad import dies
 *  instantly and loudly, but deep in a run, as an ENOENT for a path like
 *  `src/src/lib/splitFrame.ts` that reads like a typo rather than a move.
 *
 *  Two shapes did all the damage, so this file locks both:
 *
 *  1. **A path literal handed to some reader** — `new URL('../contract/x.ts')`,
 *     an array of recipe files, `src('../src/api/hooks.ts')`. Relative to the
 *     FILE, so a move retargets it, and nothing checks it until that assertion
 *     runs. Five suites shipped broken this way for the length of one test run.
 *
 *  2. **A repo ROOT the suite computes for itself** by counting `..` from its
 *     own location. A move changes the count, and the result is still a
 *     perfectly valid path — just the wrong one. This is the nastier of the
 *     two: it cannot be spotted by reading the line, only by knowing how deep
 *     the file now sits.
 *
 *  Both are checked statically, over every suite in the repo, in well under a
 *  second — which is the point. The alternative oracle is "run all 1,679 tests
 *  and read the failures", and that is exactly the tool this repo already
 *  decided must be checkable itself. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { ROOT, stripComments } from './helpers/source.ts'
import { suiteRoots } from '../scripts/verifyPlan.mjs'

/** Every suite in the repo, from the same roots the runner globs — so a layer
 *  that colocates its tests is covered here the moment it reaches the script,
 *  with no second list to keep. */
function everySuite(): string[] {
  const out: string[] = []
  for (const root of suiteRoots(join(ROOT, 'package.json'))) {
    for (const f of readdirSync(join(ROOT, root), { recursive: true })) {
      const p = String(f).split('\\').join('/')
      if (p.endsWith('.test.ts')) out.push(`${root}/${p}`)
    }
  }
  assert.ok(out.length > 100, `found only ${out.length} suites — this scan has no subject`)
  return out
}

/** Literals that are DATA, not a path the suite reads — so "does not resolve"
 *  is the point of them, not a defect. Named individually with the reason,
 *  never a pattern: a wildcard here would re-open exactly the hole this file
 *  exists to close. */
const NOT_A_READ = new Set([
  // A traversal payload: the suite asserts `/fs/text` REFUSES to serve it.
  // Were this path ever to resolve, the test would be proving nothing.
  "server/routes/fs.test.ts → '../package.json'",
])

test('every relative path a suite names resolves from where the suite now lives', () => {
  const broken: string[] = []
  for (const rel of everySuite()) {
    const dir = dirname(join(ROOT, rel))
    const src = stripComments(readFileSync(join(ROOT, rel), 'utf8'))
    // Quoted relative paths carrying a source extension: import specifiers,
    // `new URL(…)` arguments, and the bare literals fed to hand-rolled readers
    // — all the same hazard, so all one scan.
    for (const m of src.matchAll(/'(\.\.?\/[^'\n]*\.(?:ts|tsx|mjs|md|json|css))'/g)) {
      const entry = `${rel} → '${m[1]}'`
      if (!NOT_A_READ.has(entry) && !existsSync(resolve(dir, m[1]))) broken.push(entry)
    }
  }
  assert.deepEqual(
    broken,
    [],
    `a suite names a path that does not exist from its own directory — it moved and this did not:\n${broken.join('\n')}`,
  )
})

test('no suite computes its own repo ROOT — it imports the one home', () => {
  // `join(dirname(fileURLToPath(import.meta.url)), '..')` is right only for a
  // suite sitting exactly one level down. Colocation moved suites to depths 1,
  // 2 and 3, and every hand-counted `..` that did not move with them produced a
  // valid, wrong path. `tests/helpers/source.ts` computes ROOT once, from a
  // location that is not going to move; everyone else imports it. Same
  // registries-have-one-home rule the UI applies to sections and palettes.
  const offenders: string[] = []
  for (const rel of everySuite()) {
    // helpers/ is where the one home lives; it is allowed to compute it.
    if (rel.includes('/helpers/')) continue
    const src = stripComments(readFileSync(join(ROOT, rel), 'utf8'))
    if (/(?:dirname\(fileURLToPath\(import\.meta\.url\)\)|import\.meta\.dirname)\s*,\s*'\.\./.test(src))
      offenders.push(`${rel}: computes ROOT by counting '..' — import { ROOT } from the source helper`)
    if (/new URL\(`\.\.\//.test(src))
      offenders.push(`${rel}: builds repo paths with a '..' template — import { ROOT, read } instead`)
  }
  assert.deepEqual(offenders, [], `hand-counted repo roots break silently on a move:\n${offenders.join('\n')}`)
})
