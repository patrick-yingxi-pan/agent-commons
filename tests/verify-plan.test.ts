/** The verification sweep's own coverage (`scripts/verifyPlan.mjs`).
 *
 *  `npm run verify` is what AGENTS.md now points at for "is this change done".
 *  Three functions decide what it actually runs — which node suites, which spec
 *  files, and how those split across shards — and every way they can be wrong
 *  SUBTRACTS tests while the run still reports green. That is the one defect a
 *  verification tool must not have, and it is invisible to the tool itself.
 *
 *  So the plan is a module of its own, and these are its locks. Each was earned
 *  by a real defect in the first cut of the runner (2026-08-11 review). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ROOT, stripComments } from './helpers/source.ts'
import { envCount, specFiles, specGroups, suiteDirs, suiteFiles, suiteRoots } from '../scripts/verifyPlan.mjs'

test('the sweep runs every node suite the `npm test` glob does', () => {
  // Two enumerations of one set. `package.json`'s `test` script is a RECURSIVE
  // glob; the runner's first cut used a flat `readdirSync`. They agree while
  // every suite sits directly in `tests/`, and the day one lands in a
  // subdirectory the sweep silently stops running it — the lane still goes
  // green, just over fewer files.
  const script = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts.test
  assert.match(script, /tests\/\*\*\/\*\.test\.ts/, 'the npm script globs recursively — so the plan must too')

  // Since the suites colocated with the code they lock there is more than one
  // root, so a whole ROOT can now go missing the way a subdirectory could
  // before — silently, lane still green over fewer tests. Reading the roots out
  // of the `test` script gives one source of truth for WHICH run; it says
  // nothing about whether that set covers the suites on disk. Naming two roots
  // by hand here left the other two unguarded: deleting `src/**` from the glob
  // hid 70 suites with all six of these tests green. So coverage is asked of
  // the FILESYSTEM — a directory that holds suites and is not globbed fails
  // here, whatever it is called and whoever forgot it.
  const roots = suiteRoots(join(ROOT, 'package.json'))
  const globbed = new Set(roots)
  const onDiskRoots = suiteDirs(ROOT)
  assert.ok(onDiskRoots.length >= 3, `only ${onDiskRoots.length} directories hold suites — this check has no subject`)
  const unglobbed = onDiskRoots.filter((d) => !globbed.has(d))
  assert.deepEqual(
    unglobbed,
    [],
    `these directories contain suites that \`npm test\` never runs: ${unglobbed.join(', ')} — add them to the test script`,
  )

  const planned = new Set(suiteFiles(roots.map((r) => join(ROOT, r))).map((f) => f.split('\\').join('/')))
  const onDisk: string[] = []
  for (const root of roots) {
    for (const f of readdirSync(join(ROOT, root), { recursive: true })) {
      const p = String(f).split('\\').join('/')
      if (p.endsWith('.test.ts')) onDisk.push(`${join(ROOT, root).split('\\').join('/')}/${p}`)
    }
  }
  assert.ok(onDisk.length > 0, 'there are suites to find')
  for (const f of onDisk) assert.ok(planned.has(f), `the sweep would skip ${f}`)
  assert.equal(planned.size, onDisk.length, 'and it invents nothing')
  assert.ok([...planned].some((f) => f.endsWith('tests/verify-plan.test.ts')), 'including this one')

  // Still against a FIXTURE. Real suites do now sit in subdirectories, so the
  // assertions above would finally catch a flat readdir — but they would catch
  // it for a reason that is a fact about today's tree, and the tree is exactly
  // what keeps changing. Mutating the implementation back to flat once left
  // this test green until this block existed; a lock that only holds because of
  // the current layout is not a lock on recursion.
  const tmp = mkdtempSync(join(tmpdir(), 'verify-plan-'))
  try {
    mkdirSync(join(tmp, 'nested'))
    writeFileSync(join(tmp, 'top.test.ts'), '')
    writeFileSync(join(tmp, 'nested', 'deep.test.ts'), '')
    writeFileSync(join(tmp, 'nested', 'notatest.ts'), '')
    assert.deepEqual(
      suiteFiles(tmp).map((f) => f.slice(tmp.length + 1)),
      ['nested/deep.test.ts', 'top.test.ts'],
      'a suite in a subdirectory is found, and a non-suite beside it is not',
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('the shard groups PARTITION the spec files — every one, exactly once', () => {
  const all = specFiles().map((f) => f.file)
  assert.ok(all.length > 1, 'there are specs to split')
  for (const n of [1, 2, 3, 5, all.length, all.length + 7, 100]) {
    const groups = specGroups(n)
    const flat = groups.flat()
    assert.deepEqual([...flat].sort(), [...all].sort(), `n=${n}: every spec runs, exactly once`)
    // The one that bites: an EMPTY group reaches `playwright test` with no path
    // arguments, and that runs the WHOLE suite. So the shape meaning "this
    // shard has nothing to do" is the shape that silently does everything —
    // and it is reachable, since the shard count is capped at half the core
    // count, which on a large machine exceeds the number of spec files.
    for (const g of groups) assert.ok(g.length > 0, `n=${n}: no empty group (it would run the entire suite)`)
    assert.ok(groups.length <= Math.max(1, Math.min(n, all.length)), `n=${n}: never more groups than files`)
  }
})

test('the groups are BALANCED — the heaviest is not the whole suite', () => {
  // Playwright's own `--shard=i/n` splits by declaration order and gave 34 / 16
  // / 22 of 72; the sweep then waits on the unlucky lane. This is not a claim
  // about wall-clock (a test count is a weak proxy for a duration, and
  // measuring it bought 2s) — it is a claim that no lane draws a pathological
  // share, which is what protects the sweep as the suite grows.
  const weights = new Map(specFiles().map((f) => [f.file, Math.max(1, f.tests)]))
  const total = [...weights.values()].reduce((a, b) => a + b, 0)
  for (const n of [2, 3, 4]) {
    const load = specGroups(n).map((g) => g.reduce((s, f) => s + (weights.get(f) ?? 0), 0))
    const heaviest = Math.max(...load)
    // A greedy longest-first fit is within (4/3)·optimum; the single biggest
    // file is an unavoidable floor, so the bound has to admit it.
    const floor = Math.max(...weights.values())
    assert.ok(
      heaviest <= Math.max(floor, (total / n) * 1.5),
      `n=${n}: heaviest lane ${heaviest} of ${total} — the split is lopsided (${load.join(' / ')})`,
    )
  }
})

test('a malformed shard count falls back instead of poisoning the plan with NaN', () => {
  // `Number('two')` is NaN, and NaN survives Math.max/Math.min unchanged. It
  // reached `Array.from({length: NaN})` and died in an empty-array `reduce`,
  // several frames from the typo that caused it.
  for (const bad of ['two', '', '0', '-1', '2.5', 'NaN', ' ']) {
    assert.equal(envCount('X', 3, { X: bad }), 3, `${JSON.stringify(bad)} falls back to the default`)
  }
  assert.equal(envCount('X', 3, {}), 3, 'absent falls back')
  assert.equal(envCount('X', 3, { X: '5' }), 5, 'and a real count is honoured')
  // Anything ignored is SAID, not swallowed — a silently ignored setting is how
  // someone concludes the flag does not work.
  let said = ''
  envCount('E2E_SHARDS', 3, { E2E_SHARDS: 'two' }, (m) => (said = m))
  assert.match(said, /E2E_SHARDS/, 'the ignored value is reported')
})

test('the runner never reports success without running anything', () => {
  // Both shapes: a filter that matches no lane, and (above) a group that runs
  // the whole suite because it was empty. The first cut printed "all 0 lanes
  // green" and exited 0 for `verify chekcs` — a verification tool passing while
  // running nothing is the one failure it must never have.
  const run = (args: string) => {
    try {
      return { code: 0, out: execSync(`node scripts/verify.mjs ${args}`, { cwd: ROOT, encoding: 'utf8' }) }
    } catch (e: any) {
      return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }
    }
  }
  const miss = run('chekcs')
  assert.notEqual(miss.code, 0, 'a filter matching no lane must not exit 0')
  assert.match(miss.out, /no lane matches/, 'and it says so')
})

test('the runner survives a step it cannot even spawn', () => {
  // A ChildProcess 'error' with no listener is RETHROWN by EventEmitter, so an
  // unspawnable command killed the whole runner with a bare stack trace and
  // took the other lanes' in-flight results with it. It must degrade to one
  // failed lane. Asserted on the source, because provoking a real ENOENT means
  // breaking PATH for a child process.
  // Comment-stripped: the prose below explains why process.exit() is banned,
  // and an un-stripped scan matches the ban itself.
  const src = stripComments(readFileSync(join(ROOT, 'scripts', 'verify.mjs'), 'utf8'))
  assert.match(src, /child\.on\('error'/, "the child's 'error' event is handled")
  assert.match(src, /process\.exitCode/, 'the exit is a code, not process.exit')
  assert.doesNotMatch(
    src,
    /process\.exit\(/,
    'never process.exit(): writes to a pipe are async on win32, and it discards the failure tail',
  )
})
