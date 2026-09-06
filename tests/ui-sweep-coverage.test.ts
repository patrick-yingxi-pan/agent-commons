/** The /ui-review sweep must not report a matrix it never ran (2026-07-23).
 *
 *  Two escapes, one class. The harness reported "0 violations, 31 skips" where
 *  nearly every skip was a narrow-tier cell it could not navigate to — a green
 *  headline over an unswept column. The rewrite that fixed those skips then
 *  introduced the sharper version: an unguarded `locator.click` timeout escaped
 *  as an uncaught rejection and killed the run at the FIRST narrow viewport, so
 *  four later columns never ran and the process printed a stack trace instead of
 *  a RESULT line. Both times the harness's own failure looked like the product's
 *  cleanliness.
 *
 *  The rule now: silence about a cell is a VIOLATION, not a pass, and no
 *  navigation error is fatal. This locks the ledger's behavior (imported
 *  directly — no browser needed), the manifest against the cells the sweep
 *  actually visits, and the harness's loud-not-fatal navigation contract. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { ROOT, read as readAbs } from './helpers/source.ts'
import { CELLS, SECTIONS, createLedger } from '../scripts/ui-sweep-ledger.mjs'

const read = (p: string) => readAbs(join(ROOT, p))
const SWEEP = read('scripts/ui-sweep.mjs')

// ── the ledger: what a green run is allowed to mean ─────────────────────────

test('a cell the sweep never reached closes as a COVERAGE violation', () => {
  const ledger = createLedger(['alpha', 'beta'])
  ledger.covered('320x700/alpha')
  const out = ledger.close('320x700')
  assert.equal(out.length, 1, 'exactly the untouched cell reports')
  assert.equal(out[0].cell, '320x700/beta')
  assert.equal(out[0].invariant, 'COVERAGE')
  assert.match(out[0].detail, /UNSWEPT/)
})

test('the recorded reason reaches the violation — an unreachable cell says why', () => {
  const ledger = createLedger(['alpha'])
  ledger.unreachable('375x812/alpha', 'the rail drawer would not open')
  const [v] = ledger.close('375x812')
  assert.match(v.detail, /the rail drawer would not open/)
})

test('a cell with no recorded reason still reports — silence is never a pass', () => {
  const ledger = createLedger(['alpha'])
  const [v] = ledger.close('1280x800')
  assert.equal(v.cell, '1280x800/alpha')
  assert.match(v.detail, /never reached it/)
})

test('covered beats unreachable in both orders — one failed route is not a verdict', () => {
  // A cell can fail one approach and be reached by another; the ledger must not
  // report a cell whose checks demonstrably ran, in either arrival order.
  const first = createLedger(['alpha'])
  first.unreachable('320x700/alpha', 'first route failed')
  first.covered('320x700/alpha')
  assert.deepEqual(first.close('320x700'), [], 'unreachable then covered → covered')

  const second = createLedger(['alpha'])
  second.covered('320x700/alpha')
  second.unreachable('320x700/alpha', 'a later route failed')
  assert.deepEqual(second.close('320x700'), [], 'covered then unreachable → still covered')
})

test('a column that ran nothing reports every cell in the manifest', () => {
  // The uncaught-timeout shape: the guard catches, the ledger still speaks for
  // the whole column rather than letting it pass in silence.
  const ledger = createLedger()
  const out = ledger.close('320x700')
  assert.equal(out.length, CELLS.length)
  assert.ok(out.every((v) => v.invariant === 'COVERAGE'))
})

test('the ledger counts swept cells across columns — the RESULT line is a real fraction', () => {
  const ledger = createLedger(['alpha', 'beta'])
  ledger.covered('320x700/alpha')
  ledger.covered('375x812/alpha')
  ledger.covered('375x812/alpha') // idempotent
  assert.equal(ledger.size, 2)
})

// ── the manifest tracks the sweep ───────────────────────────────────────────

test('every cell the sweep visits is in the manifest — no cell escapes the ledger', () => {
  // `at('name')` is the sweep's one cell-naming call. A cell it visits without
  // declaring is a cell the ledger would never ask about.
  const visited = [...SWEEP.matchAll(/\bat\('([a-z0-9-]+)'\)/g)].map((m) => m[1])
  assert.ok(visited.length >= 8, `expected the sweep to name cells literally, found ${visited.length}`)
  for (const name of new Set(visited)) {
    assert.ok(CELLS.includes(name), `the sweep visits "${name}" but the manifest does not list it`)
  }
})

test('every manifest cell is really swept — the promise is not padded', () => {
  // The reverse drift: a cell listed but never visited would report as a
  // permanent violation, training the reader to ignore COVERAGE.
  const visited = new Set([...SWEEP.matchAll(/\bat\('([a-z0-9-]+)'\)/g)].map((m) => m[1]))
  const fromSections = new Set(SECTIONS)
  assert.ok(
    SWEEP.includes('at(section)'),
    'the section cells are named from SECTIONS — keep the loop naming them that way',
  )
  for (const name of CELLS) {
    assert.ok(
      visited.has(name) || fromSections.has(name),
      `the manifest promises "${name}" but the sweep never visits it`,
    )
  }
})

test('the section matrix is exactly the product registry — no top-level surface can disappear silently', () => {
  const registry = read('src/lib/sections.tsx')
  const body = registry.match(/export const SECTION_ORDER:[^=]+=[\s\S]*?\[([\s\S]*?)\]/)?.[1]
  assert.ok(body, 'SECTION_ORDER remains structurally enumerable')
  const productOrder = [...body.matchAll(/'([^']+)'/g)].map((match) => match[1])
  assert.deepEqual(SECTIONS, productOrder)
})

// ── loud, never fatal ───────────────────────────────────────────────────────

test('a cell is never downgraded to a skip — skip() is for sub-checks only', () => {
  // `skip()` prints but does not fail. Using it for a whole cell is exactly how
  // 31 unswept cells read as "0 violations".
  for (const call of SWEEP.matchAll(/\bskip\(([^)]*)\)/g)) {
    assert.ok(
      !/UNSWEPT/i.test(call[1]),
      `an unswept cell must be a COVERAGE violation, not a skip: skip(${call[1]})`,
    )
  }
  assert.ok(SWEEP.includes("'COVERAGE'"), 'the sweep raises COVERAGE violations')
})

test('popover enumeration follows the live DOM instead of stale numeric indexes', () => {
  // Opening a trigger can reconcile or collapse its rail branch. A count taken
  // before the first click plus monotonically increasing nth(i) then skips the
  // controls that shifted left and eventually points past the live list. The
  // 1280px project/artifact/agent cells exposed that as three tolerated skips.
  const fn = SWEEP.slice(SWEEP.indexOf('async function sweepTriggers'))
  const body = fn.slice(0, fn.indexOf('\nconst shot'))
  assert.ok(body.includes('while (true)'), 'trigger selection repeats against the current DOM')
  assert.ok(body.includes('const liveCount = await triggers.count()'), 'each pass recounts live triggers')
  assert.ok(body.includes('if (seen.has(candidateLabel)) continue'), 'a stable label prevents repeat clicks')
  assert.doesNotMatch(body, /const n = await triggers\.count\(\)/, 'no pre-interaction count controls the loop')
})

test('a failed rail-drawer open is reported and returns — it never throws', () => {
  const fn = SWEEP.slice(SWEEP.indexOf('async function openRailIfNarrow'))
  const body = fn.slice(0, fn.indexOf('\nasync function closeRailIfNarrow'))
  assert.ok(
    body.includes('await dismissOverlayPanel(page)'),
    'a covering context panel is dismissed BEFORE reaching for the toggle — that overlay is what stranded the column',
  )
  assert.ok(body.includes("note(cell, 'COVERAGE'"), 'a drawer that will not open is a COVERAGE violation')
  assert.ok(body.includes('return false'), 'the caller learns it failed instead of eating an exception')
  assert.ok(!/\bthrow\b/.test(body), 'the helper must not throw — one timeout used to kill the whole run')
})

test('each viewport column is guarded, and closes its ledger no matter how it ended', () => {
  // The uncaught-rejection regression: without the guard, the first narrow
  // timeout ended the process and four columns never ran.
  assert.match(
    SWEEP,
    /catch \(e\) \{\s*note\(`\$\{vp\.name\}\/\*`, 'COVERAGE', `the column aborted/,
    'a thrown column is a COVERAGE violation, not a crash',
  )
  assert.match(
    SWEEP,
    /finally \{[\s\S]{0,400}ledger\.close\(vp\.name\)/,
    'the ledger closes the column in a finally — an aborted column still reports',
  )
})

test('an address that renders no workspace is unreachable, not swept', () => {
  // Sweeping a blank page and reporting it clean is the same false confidence
  // in a different disguise.
  const fn = SWEEP.slice(SWEEP.indexOf('async function goTo'))
  const body = fn.slice(0, fn.indexOf('\n/** Real ids'))
  assert.ok(body.includes("locator('main')"), 'goTo checks the address actually opened a workspace')
  assert.ok(body.includes('unreachable(cell,'), 'a dead address records the cell unreachable')
})

// ── the stack the sweep drives ──────────────────────────────────────────────

test('the sweep boots its own isolated stack by default, never the dev server', () => {
  // The 31 unswept cells came from the shared dev store: a long-lived world the
  // developer mutates between runs, which is why the same harness passed in the
  // morning and skipped a whole column in the evening. Same reasoning as
  // playwright.config.ts's dedicated ports + DATA_FILE.
  const port = SWEEP.match(/const PORT = Number\(process\.env\.UI_SWEEP_PORT \?\? (\d+)\)/)
  assert.ok(port, 'the owned stack declares its own default port (overridable with UI_SWEEP_PORT)')
  assert.notEqual(port[1], '5173', "the default port must not be the dev server's")
  assert.ok(/ui-sweep-store\.json/.test(SWEEP), 'the owned stack gets its own store file')
  assert.ok(SWEEP.includes('rmSync'), 'the store is wiped per run — a clean slate, like e2e/wipe-store.mjs')
  assert.ok(SWEEP.includes('UI_SWEEP_BASE'), 'an already-running server can still be driven explicitly')
})

test('the owned stack is really GATED, and the sweep proves it before sweeping', () => {
  // `AUTH_GATE` counts as on only for the exact string 'require'
  // (`process.env.AUTH_GATE === 'require'`, server/store/index.ts). A plausible
  // spelling — 'on' — reads as OFF, and every cell would then render the
  // ANONYMOUS principal's world while the log still said the sweep signed in as
  // Ada. Measuring a different app than you claim is the same failure class as
  // measuring none. (Caught reviewing this very change: the first draft passed 'on'.)
  const gate = SWEEP.match(/AUTH_GATE: '([^']*)'/)
  assert.ok(gate, 'the owned stack pins the gate explicitly rather than inheriting it')
  assert.equal(gate[1], 'require', "only 'require' turns the gate on — any other value silently opens the door")
  assert.match(SWEEP, /anonymous GET \/sessions/, 'and the boot asserts the gate is really up before sweeping')
})

test('the owned stack renders the conditional maintainer section in full', () => {
  assert.match(SWEEP, /MAINTAINERS: 'user-ada'/, 'the isolated stack grants its signed-in account')
  assert.match(
    SWEEP,
    /me\?\.instanceAdmin !== true[\s\S]{0,180}?note\(at\('admin'\), 'COVERAGE'/,
    'the sweep refuses to substitute the denied deep-link face for the full admin surface',
  )
})

test('readiness waits on the API, not just the UI', () => {
  // Vite answers `/` the moment it binds; the mock backend is a separate process
  // still starting, so the first `/api/v1/*` calls hit a dead proxy target. The
  // sign-in POST swallows its own errors, so that race could land a whole sweep
  // of the signed-out world silently.
  assert.match(
    SWEEP,
    /waitForServer\(`\$\{BASE\}\/api\/v1\/me`/,
    'the boot waits on an API route, so both processes are up before the first request',
  )
})

test('a busy port fails loudly — Vite would silently slide onto the API port', () => {
  // vite.config.ts sets no strictPort: a taken UI port becomes PORT+1, which is
  // the mock backend's. Sweeping that stack would be meaningless.
  assert.ok(SWEEP.includes('portFree'), 'the sweep checks its ports before booting')
  assert.match(SWEEP, /process\.exit\(2\)/, 'an unusable stack exits distinctly from a violation exit')
})

// ── the enumeration handle the harness depends on ───────────────────────────

test('the docked context panel carries the stamp the sweep looks for', () => {
  // On narrow, OverlayPanelDock spans the whole thread — including the rail
  // toggle — and closes only via its own Close (Escape does not dismiss it). A
  // cell that walked away from an open panel stranded every later cell in the
  // column. The sweep detects the live dock through this stamp; if the stamp
  // moves, the detector silently stops matching and the class returns.
  const dock = read('src/components/OverlayPanelDock.tsx')
  assert.ok(dock.includes('data-overlay-dock'), 'the dock is enumerable in the DOM')
  // Scope to the detector, not the whole file: another mention elsewhere would
  // let this pass while the actual query drifted onto a class name.
  const detector = SWEEP.slice(SWEEP.indexOf('const overlayDockLive'))
  const body = detector.slice(0, detector.indexOf('\n/** Close a docked panel'))
  assert.ok(body.includes('[data-overlay-dock]'), 'the live-dock detector queries the stamp, not a class name')
  assert.ok(
    body.includes('pointerEvents'),
    'presence is not the question — the dock stays mounted while empty, so the sweep asks whether it eats pointer events',
  )
})
