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
import { createVerifyInterruptionFixture, removeVerifyInterruptionFixture, startFixtureVerifier } from './helpers/verifyInterruptionFixture.mjs'
import { e2ePartition, envCount, specFiles, specGroups, specWeights, suiteConcurrency, suiteDirs, suiteFiles, suiteRoots, weightsFrom } from '../scripts/verifyPlan.mjs'

test('full verification can retain first-failure browser traces without enabling retries', () => {
  const config = stripComments(readFileSync(join(ROOT, 'playwright.config.ts'), 'utf8'))
  assert.match(config, /trace: process\.env\.E2E_TRACE === '1' \? 'retain-on-failure' : 'on-first-retry'/)
  assert.match(config, /retries: process\.env\.CI \? 1 : 0/, 'diagnostics do not change the first-attempt local gate')
})

test('CI rejects flaky E2E retries and exposes lane tails on coverage mismatch', () => {
  const config = stripComments(readFileSync(join(ROOT, 'playwright.config.ts'), 'utf8'))
  assert.match(config, /failOnFlakyTests:\s*!\!process\.env\.CI/, 'a test that only passes on retry is a CI failure')

  const runner = stripComments(readFileSync(join(ROOT, 'scripts', 'verify.mjs'), 'utf8'))
  assert.match(runner, /coverage\.shortfall/, 'the runner has an explicit coverage-mismatch branch')
  assert.match(
    runner,
    /coverage mismatch[\s\S]{0,800}lane\.out|lane\.out[\s\S]{0,800}coverage mismatch/,
    'coverage mismatches print the relevant E2E lane output rather than only a count',
  )
  assert.match(runner, /if \(failed\.length > 0 \|\| coverage\.shortfall\) process\.exitCode = 1/)
})

test('coverage mismatch emits the E2E lane tail and exits nonzero', { timeout: 15_000 }, async () => {
  const fixture = await createVerifyInterruptionFixture()
  let verifier: ReturnType<typeof startFixtureVerifier>
  const run = async () => {
    verifier = startFixtureVerifier(fixture, { reportedPasses: 1, runnerArgs: ['e2e'] })
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        verifier.closed,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`fixture verifier exceeded 5s; output=${verifier.output().slice(-2_000)}`)), 5_000)
        }),
      ])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
  try {
    // This subprocess tests coverage reporting, not host speed. Make accidental
    // calibration observable without timing an arbitrary amount of CPU work.
    const hostPath = join(fixture.root, 'scripts', 'hostSpeed.mjs')
    const hostSource = readFileSync(hostPath, 'utf8')
    const calibration = 'export function calibrationMs(rounds = 5, iterations = CALIBRATION_ITERATIONS) {'
    assert.ok(hostSource.includes(calibration), 'the fixture mutation found the real calibration entry')
    writeFileSync(hostPath, hostSource.replace(calibration,
      `${calibration}\n  throw new Error('Unexpected fixture calibration')`))
    let result = await run()
    assert.doesNotMatch(verifier.output(), /Unexpected fixture calibration/,
      'coverage fixtures use a fixed host profile, not unrelated CPU calibration')
    assert.equal(result.code, 1, `a coverage shortfall remains a verification failure; output=${verifier.output().slice(-2_000)}`)
    assert.match(verifier.output(), /coverage mismatch diagnostics \(1 of 2\)/)
    assert.match(verifier.output(), /e2e output \(coverage mismatch\)/)
    assert.match(verifier.output(), /e2e\/first\.spec\.ts:1:1/, 'the lane tail is not swallowed when the lane itself exits 0')
    assert.match(verifier.output(), /1 passed/)

    // Watch the executable assertion distinguish the diagnostic block itself:
    // remove only that block from the fixture runner and prove its output is
    // absent, while the shortfall still fails. The production runner is never
    // modified.
    const runnerSource = readFileSync(fixture.runner, 'utf8')
    const diagnosticStart = runnerSource.indexOf('if (coverage.shortfall) {')
    const diagnosticEnd = runnerSource.indexOf('}\nprocess.stdout.write(', diagnosticStart)
    assert.ok(diagnosticStart >= 0 && diagnosticEnd > diagnosticStart, 'fixture mutation found the diagnostic block')
    const withoutDiagnostics = `${runnerSource.slice(0, diagnosticStart)}${runnerSource.slice(diagnosticEnd + 2)}`
    writeFileSync(fixture.runner, withoutDiagnostics)
    result = await run()
    assert.equal(result.code, 1, `the shortfall still fails after mutating diagnostics; output=${verifier.output().slice(-2_000)}`)
    assert.doesNotMatch(verifier.output(), /coverage mismatch diagnostics/)
  } finally {
    await removeVerifyInterruptionFixture(fixture, verifier)
  }
})

test('parallel Playwright shards write artifacts to shard-qualified output directories', () => {
  const config = stripComments(readFileSync(join(ROOT, 'playwright.config.ts'), 'utf8'))
  assert.match(
    config,
    /outputDir:\s*`test-results\/shard-\$\{SHARD\}`/,
    'parallel processes must not share test-results or race while cleaning trace artifacts',
  )
})

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

test('Node test concurrency comes from one valid bounded npm test option', () => {
  const script = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts.test
  assert.match(script, /node --test --test-concurrency=4 /, 'npm test owns the authoritative worker count')
  assert.equal(suiteConcurrency(join(ROOT, 'package.json')), 4)

  const tmp = mkdtempSync(join(tmpdir(), 'verify-concurrency-'))
  const pkgPath = join(tmp, 'package.json')
  const writeScript = (testScript: string | undefined) => {
    writeFileSync(pkgPath, JSON.stringify({ scripts: testScript === undefined ? {} : { test: testScript } }))
  }
  try {
    for (const invalid of [
      undefined,
      'node --test "tests/**/*.test.ts"',
      'node --test --test-concurrency=4 --test-concurrency=3 "tests/**/*.test.ts"',
      'node --test --test-concurrency "tests/**/*.test.ts"',
      'node --test --test-concurrency= "tests/**/*.test.ts"',
      'node --test --test-concurrency=bad "tests/**/*.test.ts"',
      'node --test --test-concurrency=0 "tests/**/*.test.ts"',
      'node --test --test-concurrency=-1 "tests/**/*.test.ts"',
      'node --test --test-concurrency=17 "tests/**/*.test.ts"',
    ]) {
      writeScript(invalid)
      assert.throws(() => suiteConcurrency(pkgPath), /test-concurrency|test` script/, String(invalid))
    }
    for (const [count, expected] of [['1', 1], ['4', 4], ['16', 16]] as const) {
      writeScript(`node --test --test-concurrency=${count} "tests/**/*.test.ts"`)
      assert.equal(suiteConcurrency(pkgPath), expected)
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('verification keeps complete suite coverage and uses the npm test concurrency', () => {
  const runner = stripComments(readFileSync(join(ROOT, 'scripts', 'verify.mjs'), 'utf8'))
  assert.match(runner, /const SUITE = suiteFiles\(\)/, 'the planned node suite list is unchanged')
  assert.match(runner, /const NODE_TEST_CONCURRENCY = suiteConcurrency\(\)/)
  assert.match(
    runner,
    /args: \['--test', `--test-concurrency=\$\{NODE_TEST_CONCURRENCY\}`, \.\.\.SUITE\]/,
    'the verifier passes the npm-owned concurrency without changing the suite manifest',
  )
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
    // and it is reachable: the shard count comes from the core count, which on
    // a large machine exceeds the number of spec files.
    for (const g of groups) assert.ok(g.length > 0, `n=${n}: no empty group (it would run the entire suite)`)
    assert.ok(groups.length <= Math.max(1, Math.min(n, all.length)), `n=${n}: never more groups than files`)
  }
})

test('external E2E partitions divide the same manifest and fail closed when misconfigured', () => {
  const all = specFiles()
  const left = e2ePartition({ VERIFY_E2E_PARTS: '2', VERIFY_E2E_PART: '1' }, all)
  const right = e2ePartition({ VERIFY_E2E_PARTS: '2', VERIFY_E2E_PART: '2' }, all)
  assert.equal(left.parts, 2)
  assert.equal(right.parts, 2)
  assert.deepEqual(
    [...left.files, ...right.files].sort(),
    all.map((f) => f.file).sort(),
    'the isolated runners cover every spec exactly once between them',
  )
  assert.equal(new Set([...left.files, ...right.files]).size, all.length, 'no spec is duplicated between runners')

  const whole = e2ePartition({}, all)
  assert.deepEqual(whole.files.sort(), all.map((f) => f.file).sort(), 'no partition variables means the full local sweep')
  for (const env of [
    { VERIFY_E2E_PARTS: '2' },
    { VERIFY_E2E_PART: '1' },
    { VERIFY_E2E_PARTS: 'two', VERIFY_E2E_PART: '1' },
    { VERIFY_E2E_PARTS: '2', VERIFY_E2E_PART: '0' },
    { VERIFY_E2E_PARTS: '2', VERIFY_E2E_PART: '3' },
  ]) assert.throws(() => e2ePartition(env, all), /partition|supplied together/, JSON.stringify(env))
  assert.throws(
    () => e2ePartition({ VERIFY_E2E_PARTS: String(all.length + 1), VERIFY_E2E_PART: '1' }, all),
    /exceeds/,
    'an empty partition must not reach Playwright as an accidental full-suite invocation',
  )
})

test('the groups are BALANCED — the heaviest is not the whole suite, cache or no cache', () => {
  // Playwright's own `--shard=i/n` splits by declaration order and gave 34 / 16
  // / 22 of 72; the sweep then waits on the unlucky lane.
  //
  //  TWO cases, because the planner has two inputs and this used to conflate
  //  them. It asserted count-balance of a WEIGHT-driven split — measuring the
  //  greedy fit against a quantity it was not optimising — which is green
  //  exactly when the durations happen to track the counts. On a fresh clone
  //  (no `.data/spec-weights.json`) the two are identical and it passed
  //  vacuously; here, after a real sweep recorded shares, the same code gave
  //  20 / 38 / 14 tests over three lanes and failed the machine rather than the
  //  algorithm. A lock whose subject is a gitignored artifact tests something
  //  different on every box, and green in CI was never evidence.
  //
  //  So each split is now weighed by the quantity it was built from.
  //
  //  **What each arm is worth, measured rather than assumed.** Mutating the
  //  greedy fit to heaviest-first fails the no-cache arm immediately. Three
  //  other mutations — splitting by FILE count, dropping the heaviest-first
  //  sort, alphabetical order — pass BOTH arms: over 24 spec files and three
  //  lanes, greedy is forgiving and a 1.5× bound is loose. So the recorded-share
  //  arm has not been watched failing, and is a guard against a future planner
  //  rather than a test that currently discriminates. Said here because the
  //  opposite claim is what the old spelling made by accident.
  const cases = [
    { label: 'no cache — the split falls back to test count', files: specFiles('e2e', {}), of: (f) => Math.max(1, f.tests) },
    { label: 'recorded shares — the split follows measured duration', files: specFiles(), of: (f) => f.weight },
  ] as const
  for (const { label, files, of } of cases) {
    const weights = new Map(files.map((f) => [f.file, of(f)]))
    const total = [...weights.values()].reduce((a, b) => a + b, 0)
    for (const n of [2, 3, 4]) {
      const load = specGroups(n, files).map((g) => g.reduce((s, f) => s + (weights.get(f) ?? 0), 0))
      const heaviest = Math.max(...load)
      // A greedy longest-first fit is within (4/3)·optimum; the single biggest
      // file is an unavoidable floor, so the bound has to admit it — a lane can
      // never be shorter than its longest spec, which is why splitting the
      // biggest FILE is the only thing that moves that floor.
      const floor = Math.max(...weights.values())
      assert.ok(
        heaviest <= Math.max(floor, (total / n) * 1.5),
        `${label}, n=${n}: heaviest lane ${heaviest.toFixed(3)} of ${total.toFixed(3)} — lopsided (${load
          .map((v) => v.toFixed(3))
          .join(' / ')})`,
      )
    }
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

/** ── The duration cache ──────────────────────────────────────────────────────
 *
 *  Sharding by test COUNT produced an even 24/24/24 that ran 179/141/182
 *  seconds — the fastest lane idle for 40s of every sweep, because
 *  `social-layer` cost 7.7s per test and `main-split` 4.8s. So the split is by
 *  measured share now.
 *
 *  A cache that plans the run is a new way for the run to be wrong, and these
 *  lock the two properties that keep it from being one: it is never a source of
 *  truth (missing, stale or corrupt must all degrade to the old behaviour), and
 *  it is host-portable (a share, not a second — so the file a Mac writes still
 *  means something on the box that reads it). */
test('the weight cache degrades to test count — it can never break the plan', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'weights-'))
  try {
    const bad = join(tmp, 'nope.json')
    assert.deepEqual(specWeights(bad), {}, 'a missing cache is empty, not a throw')
    writeFileSync(join(tmp, 'malformed.json'), '{not json')
    assert.deepEqual(specWeights(join(tmp, 'malformed.json')), {}, 'a half-written cache is empty, not a throw')
    writeFileSync(join(tmp, 'junk.json'), JSON.stringify({ a: -1, b: 'x', c: null, d: 0, e: 0.5 }))
    assert.deepEqual(specWeights(join(tmp, 'junk.json')), { e: 0.5 }, 'only usable positive numbers survive')

    // With no cache at all the planner behaves exactly as it did before it
    // existed: weight is the file's share of the test count.
    const plain = specFiles('e2e', {})
    const totalTests = plain.reduce((n, f) => n + f.tests, 0)
    assert.ok(totalTests > 0, 'there are tests to weigh')
    const sum = plain.reduce((n, f) => n + f.weight, 0)
    assert.ok(Math.abs(sum - 1) < 1e-9, `weights sum to ${sum}, not 1`)
    for (const f of plain) assert.ok(Math.abs(f.weight - f.tests / totalTests) < 1e-9, `${f.file} fell back wrong`)

    // A cache covering SOME files blends: measured where measured, counted
    // elsewhere. A new spec must not weigh zero and sink into one lane.
    const one = plain[0].file
    const blended = specFiles('e2e', { [one]: 0.9 })
    assert.equal(blended.find((f) => f.file === one).weight, 0.9, 'the measured file uses its share')
    for (const f of blended) assert.ok(f.weight > 0, `${f.file} weighs nothing — it would pile into one group`)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('recorded weights are SHARES, so the file means the same on another machine', () => {
  // Seconds would have to be re-measured per host and would be wrong the first
  // time anyone ran the sweep somewhere new. A Mac that runs everything twice
  // as fast must produce the same weights as the box that wrote them.
  const fast = weightsFrom({ 'e2e/a.spec.ts': 10, 'e2e/b.spec.ts': 30 })
  const slow = weightsFrom({ 'e2e/a.spec.ts': 20, 'e2e/b.spec.ts': 60 })
  assert.deepEqual(fast, slow, 'a uniformly slower machine records the same shares')
  assert.ok(Math.abs(Object.values(fast).reduce((a, b) => a + b, 0) - 1) < 1e-9, 'shares sum to 1')
  assert.deepEqual(weightsFrom({}), {}, 'nothing measured records nothing')
  assert.deepEqual(weightsFrom({ 'e2e/a.spec.ts': 0 }), {}, 'a zero total cannot be normalised')
})

test('the split follows the weights, not the file count', () => {
  // One heavy file and many light ones: a count-blind split would spread by
  // name; a weight-aware one isolates the heavy file and packs the rest.
  const files = [
    { file: 'e2e/heavy.spec.ts', tests: 1, weight: 0.7 },
    ...Array.from({ length: 6 }, (_, i) => ({ file: `e2e/light${i}.spec.ts`, tests: 5, weight: 0.05 })),
  ]
  const groups = specGroups(2, files)
  const weightOf = new Map(files.map((f) => [f.file, f.weight]))
  const loads = groups.map((g) => g.reduce((n, f) => n + weightOf.get(f), 0))
  const heavyLane = groups.findIndex((g) => g.includes('e2e/heavy.spec.ts'))
  assert.equal(groups[heavyLane].length, 1, 'the heavy file is alone — nothing is queued behind it')
  assert.ok(Math.max(...loads) <= 0.75, `heaviest lane ${Math.max(...loads)} — the rest did not pack`)
})
