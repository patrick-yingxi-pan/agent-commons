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
import vm from 'node:vm'
import { expect as browserExpect } from '@playwright/test'
import { join } from 'node:path'
import { ROOT, read as readAbs } from './helpers/source.ts'
import { CELLS, SECTIONS, createLedger } from '../scripts/ui-sweep-ledger.mjs'

const read = (p: string) => readAbs(join(ROOT, p))
const SWEEP = read('scripts/ui-sweep.mjs')

test('surface readiness requires visible content in the focused pane, never a loading shell or sibling', () => {
  const source = SWEEP.match(/function surfaceReady\(\) \{[\s\S]*?\n\}/)?.[0]
  assert.ok(source, 'all canonical navigation shares a rendered-surface readiness predicate')
  type State = { pane?: boolean; surface?: boolean; blocker?: string; width?: number; height?: number; visibility?: string }
  const run = ({ pane = true, surface = true, blocker = '', width = 300, height = 600, visibility = 'visible' }: State) => {
    const element = { getBoundingClientRect: () => ({ width, height }) }
    const focused = { querySelector: (selector: string) => {
      if (selector === '[data-resource-page]') return surface ? element : null
      return blocker && selector.includes(blocker) ? {} : null
    } }
    const ready = vm.runInNewContext(`(${source})`, {
      document: { querySelector: (selector: string) => {
        assert.equal(selector, 'main [data-main-pane][data-focused="true"]', 'only the actual focused main pane can qualify')
        return pane ? focused : null
      } },
      getComputedStyle: () => ({ visibility }),
    })
    return ready()
  }
  assert.equal(run({ pane: false }), false, 'a populated sibling or rail cannot stand in for the focused pane')
  assert.equal(run({ surface: false }), false, 'main/pane chrome alone is not the named surface')
  for (const blocker of ['data-section-loading', 'data-section-load-error', 'data-resource-unavailable']) {
    assert.equal(run({ blocker }), false, `${blocker} cannot count as reviewed content`)
  }
  assert.equal(run({ width: 0 }), false)
  assert.equal(run({ height: 0 }), false)
  assert.equal(run({ visibility: 'hidden' }), false)
  assert.equal(run({}), true, 'a rendered resource page can be legitimately empty')
  const conversation = read('src/components/ConversationPane.tsx')
  assert.match(conversation, /<AtomicResourcePage layout="workspace" data-conversation-pane=\{sessionId\}>/,
    'conversation and draft routes use the same positive resource-page marker')
  const frame = read('src/components/ResourcePage.tsx')
  assert.match(frame, /if \(layout === 'workspace'\)[\s\S]*?data-resource-page/)
})

test('canonical navigation cannot release checks or coverage before bounded surface readiness', async () => {
  const start = SWEEP.indexOf('async function goTo(')
  const end = SWEEP.indexOf('\n/** The sharing editor', start)
  assert.ok(start >= 0 && end > start)
  const body = SWEEP.slice(start, end)
  assert.match(body, /await page\.waitForFunction\(surfaceReady, null, \{ timeout: 8000 \}\)/)
  assert.match(body, /await page\.waitForFunction\(deferredSurfaceReady, null, \{ timeout: Math\.max\(1, readyDeadline - Date\.now\(\)\) \}\)/)
  assert.doesNotMatch(body, /await tick\(/, 'elapsed time cannot substitute for rendered content')
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  let entered!: () => void
  const entering = new Promise<void>(resolve => { entered = resolve })
  let now = 1000
  const failures: string[] = []
  const readiness = () => true
  const deferred = () => true
  const gates: unknown[] = []
  const goTo = vm.runInNewContext(`(${body})`, {
    BASE: 'http://127.0.0.1:5193', surfaceReady: readiness, deferredSurfaceReady: deferred,
    Date: { now: () => now },
    unreachable: (_cell: string, why: string) => failures.push(why),
    firstLine: (error: Error) => error.message,
  })
  let finished = false
  const pending = goTo({
    goto: async () => {},
    waitForFunction: async (predicate: unknown, argument: unknown, options: { timeout: number }) => {
      gates.push(predicate)
      assert.equal(argument, null)
      assert.equal(options.timeout, predicate === readiness ? 8000 : 6000, 'nested readiness uses the remaining navigation budget')
      if (predicate === readiness) now += 2000
      if (predicate === deferred) { entered(); await gate }
    },
  }, '/projects', '320x700/projects').then((result: boolean) => { finished = true; return result })
  await entering
  assert.equal(finished, false, 'callers cannot audit, capture or mark coverage while readiness is pending')
  assert.deepEqual(gates, [readiness, deferred], 'nested controls must settle before any caller measures the page')
  release()
  assert.equal(await pending, true)
  const rejected = await goTo({ goto: async () => {}, waitForFunction: async () => { throw new Error('still loading') } },
    '/projects', '320x700/projects')
  assert.equal(rejected, false, 'readiness failure does not enter the cell checks')
  assert.equal(failures.length, 1)
  assert.match(failures[0], /8s/)
})

test('conversation paint rejects fading, moving, disconnected and changed rows across two frames', async () => {
  const source = SWEEP.match(/async function settledConversationPaint\(\) \{[\s\S]*?\n\}/)?.[0]
  assert.ok(source, 'every screenshot shares the actual conversation paint predicate')
  type PaintNode = { isConnected: boolean; parentElement: PaintNode | null; opacity: string; visibility: string; x: number; width: number; getBoundingClientRect: () => object }
  const node = (parentElement: PaintNode | null = null): PaintNode => {
    const value = { isConnected: true, parentElement, opacity: '1', visibility: 'visible', x: 20, width: 300,
      getBoundingClientRect: () => ({ x: value.x, y: 100, width: value.width, height: 80 }) }
    return value
  }
  const run = async (rows: PaintNode[], change?: (rows: PaintNode[]) => void) => {
    let frames = 0
    const predicate = vm.runInNewContext(`(${source})`, {
      document: { querySelectorAll: (selector: string) => {
        assert.equal(selector, '[data-conversation-pane] [data-turn]', 'all rendered conversations, including rail and repo captures, are reviewed')
        return rows
      } },
      getComputedStyle: (element: PaintNode) => element,
      requestAnimationFrame: (callback: () => void) => { frames++; if (frames === 2) change?.(rows); callback() },
    })
    const result = await predicate()
    return { result, frames }
  }
  assert.deepEqual(await run([node()]), { result: true, frames: 2 })
  assert.deepEqual(await run([]), { result: true, frames: 2 }, 'empty drafts and nonconversation pages remain valid')
  assert.equal((await run([Object.assign(node(), { opacity: '0.8' })])).result, false, 'a row reveal cannot be captured')
  assert.equal((await run([node(Object.assign(node(), { opacity: '0.8' }))])).result, false, 'an ancestor reveal cannot be captured')
  assert.equal((await run([node()], rows => { rows[0].x++ })).result, false, 'motion is not settled paint')
  assert.equal((await run([node()], rows => { rows[0].isConnected = false })).result, false)
  assert.equal((await run([node()], rows => { rows[0] = node() })).result, false, 'replacement with identical geometry is a different row')
  assert.equal((await run([node()], rows => { rows.push(node()) })).result, false, 'new transcript rows require a fresh stable sample')
  assert.equal((await run([], rows => { rows.push(node()) })).result, false)
  assert.equal((await run([node()], rows => { rows.pop() })).result, false)
  assert.equal((await run([node()], rows => { rows[0].opacity = '0.5' })).result, false)
  assert.equal((await run([Object.assign(node(), { width: 0, opacity: '0' })])).result, true, 'nonrendered rows do not block unrelated captures')
  assert.equal((await run([Object.assign(node(), { visibility: 'hidden', opacity: '0' })])).result, true)
})

test('nested deferred readiness rejects only rendered owned placeholders and keeps loaded empty pages valid', () => {
  const source = SWEEP.match(/function deferredSurfaceReady\(\) \{[\s\S]*?\n\}/)?.[0]
  assert.ok(source)
  type Status = { textContent: string; width?: number; visibility?: string; proposals?: boolean }
  const run = (statuses: Status[], hasPane = true) => {
    const predicate = vm.runInNewContext(`(${source})`, {
      document: { querySelector: (selector: string) => {
        assert.equal(selector, 'main [data-main-pane][data-focused="true"]', 'hidden sibling panes cannot block the reviewed surface')
        return hasPane ? { querySelectorAll: (selector: string) => {
          assert.equal(selector, '[role="status"], [role="alert"], [data-proposals-load]')
          return statuses.map(status => ({ ...status,
            getBoundingClientRect: () => ({ width: status.width ?? 300, height: 24 }),
            hasAttribute: (name: string) => name === 'data-proposals-load' && status.proposals === true,
          }))
        } } : null
      } },
      getComputedStyle: (status: Status) => ({ visibility: status.visibility ?? 'visible' }),
    })
    return predicate()
  }
  for (const textContent of ['Loading requests…', 'Loading improvements…', 'Loading backup controls…',
    'Couldn’t load request history. Copy unsent workspace text before reloading.',
    'Couldn’t read current request access. No new action is available from stale information.',
    'Couldn’t load backup controls. Your data was not changed.']) {
    assert.equal(run([{ textContent }]), false, textContent)
    assert.equal(run([{ textContent, width: 0 }]), true, 'unrendered optional controls do not block capture')
    assert.equal(run([{ textContent, visibility: 'hidden' }]), true)
  }
  assert.equal(run([{ textContent: 'Couldn’t load improvements.', proposals: true }]), false)
  assert.equal(run([]), true)
  assert.equal(run([], false), true, 'nonworkspace captures keep their own subject gates')
  assert.equal(run([{ textContent: 'No requests yet. Requests are private to the two people involved.' }]), true)
  assert.equal(run([{ textContent: 'Saved' }]), true, 'ordinary live statuses are not loading placeholders')
  for (const path of ['src/components/AgentRequestsSummary.tsx', 'src/components/AgentRequestsSummaryRuntime.tsx']) {
    assert.match(read(path), /role="status"[^>]*>Loading requests…/)
  }
  assert.match(read('src/components/SectionView.tsx'), /role="status"[^>]*>Loading backup controls…/)
  assert.match(read('src/components/DeferredProposalsPanel.tsx'), /data-proposals-load=\{failed \? 'error' : 'loading'\}/)
})

test('capture awaits false asynchronous paint samples before taking a screenshot', async () => {
  const source = SWEEP.match(/async function shot\(page, name\) \{[\s\S]*?\n\}/)?.[0]
  assert.ok(source)
  let ready = false
  let samples = 0
  let captures = 0
  const paint = async () => { samples++; return ready }
  const capture = vm.runInNewContext(`(${source})`, {
    SHOTS: '/shots/', deferredSurfaceReady: () => true, settledConversationPaint: paint, expect: browserExpect,
  })
  const pending = capture({
    // Playwright tests the returned value's truthiness before adopting it. An
    // async false result therefore ends waitForFunction instead of polling.
    waitForFunction: async (predicate: () => unknown) => {
      const result = predicate()
      assert.ok(result)
      return await result
    },
    evaluate: (predicate: () => unknown) => predicate(),
    screenshot: async () => { captures++ },
  }, 'thread-repo')
  const outcome = pending.then(() => null, (error: unknown) => error)
  await new Promise(resolve => setImmediate(resolve))
  const premature = captures
  ready = true
  const error = await outcome
  if (error) throw error
  assert.equal(premature, 0, 'a resolved false Promise cannot admit a screenshot')
  assert.ok(samples >= 2, 'the real polling assertion must await and repeat a false paint sample')
  assert.equal(captures, 1)
})

test('screenshots and trigger review wait for bounded readiness and propagate evidence failure', async () => {
  const source = SWEEP.match(/async function shot\(page, name\) \{[\s\S]*?\n\}/)?.[0]
  assert.ok(source)
  const deferred = () => true
  const settled = async () => true
  const polling = { poll: (sample: () => Promise<boolean>, options: { timeout: number }) => {
    assert.equal(options.timeout, 8000, 'the complete paint poll retains its existing deadline')
    return { toBe: async (expected: boolean) => assert.equal(await sample(), expected) }
  } }
  const capture = vm.runInNewContext(`(${source})`, {
    SHOTS: '/shots/', deferredSurfaceReady: deferred, settledConversationPaint: settled, expect: polling,
  })
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  let entered!: () => void
  const entering = new Promise<void>(resolve => { entered = resolve })
  const calls: unknown[] = []
  const pending = capture({
    waitForFunction: async (predicate: unknown, argument: unknown, options: { timeout: number }) => {
      calls.push(predicate)
      assert.equal(argument, null)
      assert.equal(options.timeout, 8000)
    },
    evaluate: async (predicate: unknown) => { calls.push(predicate); entered(); await gate; return true },
    screenshot: async (options: { path: string }) => { calls.push(options.path) },
  }, 'thread-repo')
  await entering
  assert.deepEqual(calls, [deferred, settled], 'no screenshot while transcript paint remains unsettled')
  release()
  await pending
  assert.deepEqual(calls, [deferred, settled, '/shots/thread-repo.png'])
  for (const failure of [deferred, settled]) {
    await assert.rejects(capture({
      waitForFunction: async (predicate: unknown) => { if (predicate === failure) throw new Error('readiness timeout') },
      evaluate: async (predicate: unknown) => { if (predicate === failure) throw new Error('readiness timeout'); return true },
      screenshot: async () => assert.fail('unready content cannot become evidence'),
    }, 'thread-repo'), /readiness timeout/)
  }
  await assert.rejects(capture({ waitForFunction: async () => {}, evaluate: async () => true, screenshot: async () => { throw new Error('capture failed') } }, 'projects'), /capture failed/)
  const triggerStart = SWEEP.indexOf('async function sweepTriggers(')
  const triggerEnd = SWEEP.indexOf('\n}', triggerStart) + 2
  const triggerSource = SWEEP.slice(triggerStart, triggerEnd)
  const sweep = vm.runInNewContext(`(${triggerSource})`, { deferredSurfaceReady: deferred })
  await assert.rejects(sweep({
    waitForFunction: async (predicate: unknown, argument: unknown, options: { timeout: number }) => {
      assert.equal(predicate, deferred); assert.equal(argument, null); assert.equal(options.timeout, 8000)
      throw new Error('deferred controls unavailable')
    },
    locator: () => assert.fail('trigger inventory must wait for its deferred controls'),
  }, {}, 'agents'), /deferred controls unavailable/)
})

test('canonical artifact coverage waits for its actual surface instead of a fixed startup tick', () => {
  const start = SWEEP.indexOf("cell = at('artifact-page')")
  const end = SWEEP.indexOf("cell = at('profile-detail')", start)
  assert.ok(start >= 0 && end > start)
  const artifact = SWEEP.slice(start, end)
  assert.match(artifact, /artifactPage\.waitFor\(\{ state: 'visible', timeout: 8000 \}\)/,
    'a cold lazy artifact page gets the same bounded readiness check as the workspace')
  assert.doesNotMatch(artifact, /artifactPage\.isVisible\(\)/,
    'a one-shot visibility sample must not turn delayed rendering into a coverage hole')
  assert.ok(artifact.indexOf('artifactPage.waitFor') < artifact.indexOf('await shot'))
})

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
  const body = fn.slice(0, fn.indexOf('\n}\n') + 2)
  assert.ok(body.includes('while (true)'), 'trigger selection repeats against the current DOM')
  assert.ok(body.includes('const liveCount = await triggers.count()'), 'each pass recounts live triggers')
  assert.ok(body.includes('if (seen.has(candidateLabel)) continue'), 'a stable label prevents repeat clicks')
  assert.doesNotMatch(body, /const n = await triggers\.count\(\)/, 'no pre-interaction count controls the loop')
})

test('chip confirmation is a real covered surface, not a swallowed click or empty measurement', () => {
  const start = SWEEP.indexOf('// ── cell: the chip remove-confirm')
  const end = SWEEP.indexOf('// ── cell: the rail / drawer', start)
  assert.ok(start >= 0 && end > start, 'the chip-confirm source slice remains nonempty')
  const chip = SWEEP.slice(start, end)
  assert.doesNotMatch(chip, /chipX\.click\([\s\S]{0,160}\.catch\(\(\) => \{\}\)/, 'chip clicks cannot be swallowed')
  assert.match(chip, /dismissOverlayPanel\(page\)/, 'covering context docks are dismissed first')
  assert.match(chip, /getAttribute\('aria-label'\)/, 'the expected question is derived from the clicked control')
  assert.match(chip, /from the conversation\)\?/, 'plain and cascade confirmation questions are supported')
  assert.match(chip, /hasText: 'Cancel'/, 'the confirmation surface is required, not an unrelated popover')
  assert.match(chip, /data-popover/, 'the stamped popover is selected for measurement')
  assert.ok(chip.includes("await shot(page, cell.replace('/', '_'))"), 'the open confirmation gets a screenshot')
  assert.match(chip, /unreachable\(cell,/, 'failed click or missing confirmation becomes coverage failure')
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
  assert.ok(body.includes('waitForFunction(surfaceReady'), 'goTo checks the address actually opened a rendered workspace')
  assert.ok(body.includes('unreachable(cell,'), 'a dead address records the cell unreachable')
})

test('thread-demo uses a populated session detail instead of the blank draft or repo fallback', () => {
  const start = SWEEP.indexOf('async function seedIds')
  const end = SWEEP.indexOf('\n// ── the sweep', start)
  const seed = SWEEP.slice(start, end)
  assert.ok(seed.includes('threadSessionId'), 'seed discovery names an independent thread-demo session')
  assert.match(seed, /d\?\.messages[\s\S]{0,120}\.length\s*>\s*0/, 'thread discovery requires populated detail messages')
  assert.match(seed, /w\.repos\?\.length\s*\?\?\s*0\)\s*===\s*0/, 'thread discovery requires a non-repo conversation')
  assert.doesNotMatch(seed, /threadSessionId\s*:\s*repoSessionId/, 'thread discovery cannot fall back to the repo session')

  const demoStart = SWEEP.indexOf("// ── cell: demo thread")
  const demoEnd = SWEEP.indexOf('// ── cell: the chip remove-confirm', demoStart)
  assert.ok(demoStart >= 0 && demoEnd > demoStart, 'the thread-demo source slice remains nonempty')
  const idsAt = SWEEP.indexOf('const ids = await seedIds(page)')
  assert.ok(idsAt >= 0, 'the demo obtains real ids before its checks')
  assert.ok(idsAt < demoStart, 'the demo discovers its populated session before its checks')
  const demo = SWEEP.slice(demoStart, demoEnd)
  assert.match(demo, /ids\.threadSessionId/, 'the demo addresses the discovered populated session')
  assert.match(demo, /getByRole\('heading', \{ name: ids\.threadSessionTitle/, 'the demo waits for the discovered heading')
  assert.match(demo, /data-turn/, 'the demo waits for an actual transcript before screenshots/checks')
  assert.match(demo, /unreachable\(cell,/, 'missing thread readiness becomes a coverage violation')
  const transcriptWait = demo.indexOf("locator('[data-turn]').first().waitFor")
  const overlayGate = demo.indexOf('dismissOverlayPanel(page)')
  const screenshot = demo.indexOf('await shot(page, cell.replace')
  assert.ok(transcriptWait >= 0 && transcriptWait < screenshot, 'the transcript readiness check precedes the demo screenshot')
  assert.ok(overlayGate >= 0 && overlayGate < screenshot, 'overlay dismissal and failure gate precede the demo screenshot')
  assert.match(demo, /restored context overlay did not close before the thread screenshot/, 'overlay failure remains a coverage failure')
})

test('draft cell explicitly selects the fresh draft and proves it is empty', () => {
  const start = SWEEP.indexOf('// ── cell: a fresh draft')
  const end = SWEEP.indexOf('// ── cells: the rail sections', start)
  assert.ok(start >= 0 && end > start, 'the draft source slice remains nonempty')
  const draft = SWEEP.slice(start, end)
  assert.match(draft, /getByRole\('navigation', \{ name: 'Create', exact: true \}\)[\s\S]{0,180}getByRole\('button', \{ name: 'New session', exact: true \}\)\.click/, 'draft cell clicks New session through the Create navigation')
  assert.match(draft, /data-conversation-pane="draft"/, 'draft cell waits for the draft identity')
  assert.match(draft, /locator\('\[data-turn\]'\)\.count\(\)/, 'draft cell checks transcript emptiness')
  assert.match(draft, /turns\s*!==\s*0[\s\S]{0,100}throw/, 'draft cell rejects any restored transcript')
  assert.match(draft, /unreachable\(cell,/, 'draft setup failure becomes a coverage violation')
  const zeroGuard = draft.indexOf('turns !== 0')
  const screenshot = draft.indexOf('await shot(page, cell.replace')
  assert.ok(zeroGuard >= 0 && zeroGuard < screenshot, 'draft zero-turn rejection precedes its screenshot')
})

test('repo capture waits for its exact transcript, repository chip and visible deferred panel body', () => {
  const start = SWEEP.indexOf('// ── cell: a seeded repo session')
  const end = SWEEP.indexOf('// ── cell: a fresh draft', start)
  assert.ok(start >= 0 && end > start)
  const repo = SWEEP.slice(start, end)
  const capture = repo.indexOf('await shot')
  assert.ok(capture > 0)
  for (const gate of ['data-conversation-pane', "locator('[data-turn]')", 'ids.repoLabel', 'repoPanelsReady']) {
    const position = repo.indexOf(gate)
    assert.ok(position >= 0 && position < capture, `${gate} readiness precedes the screenshot`)
  }
  assert.match(repo, /unreachable\(cell,/, 'a missing named repo subject fails coverage')
  assert.doesNotMatch(SWEEP, /repoSessionId:\s*repoSessionId\s*\?\?\s*chipSessionId/,
    'a non-repository attachment cannot stand in for the repo cell')
  const source = SWEEP.match(/function repoPanelsReady\(sessionId\) \{[\s\S]*?\n\}/)?.[0]
  assert.ok(source)
  const run = (panels: Array<{ id?: string; visible?: boolean; loading?: boolean; body?: boolean }>) => {
    const nodes = panels.map((panel) => ({
      getAttribute: () => panel.id ?? null,
      getBoundingClientRect: () => ({ width: panel.visible === false ? 0 : 300, height: 500 }),
      querySelector: (selector: string) => selector === '[data-workspace-panel-load]' ? (panel.loading ? {} : null)
        : selector === '[aria-label="Code changes"]' && panel.body ? {} : null,
    }))
    return vm.runInNewContext(`(${source})`, {
      document: { querySelectorAll: () => nodes },
      getComputedStyle: () => ({ pointerEvents: 'auto' }),
    })('repo-session')
  }
  assert.equal(run([]), true, 'the narrow layout need not open a context panel')
  assert.equal(run([{ id: 'repo-session repo one', loading: true }]), false)
  assert.equal(run([{ id: 'repo-session repo one', body: false }]), false)
  assert.equal(run([{ id: 'repo-session repo one', body: true }]), true)
  assert.equal(run([{ id: 'repo-session repo one', visible: false, loading: true }]), true)
  assert.equal(run([{ id: 'other-session repo one', loading: true }]), true, 'unrelated context panes are not a global request gate')
  assert.equal(run([{ loading: true }]), false, 'a visible overlay loading shell is not the repository body')
})

// ── the stack the sweep drives ──────────────────────────────────────────────

test('the owner sharing sweep selects write-grade ownership, not registry position', () => {
  const expression = SWEEP.match(/projectId: (.+),/)?.[1]
  assert.ok(expression, 'the sweep derives a canonical project identity')
  const select = (projects: Array<{ id: string; own?: boolean }>) =>
    vm.runInNewContext(expression, { projects, arr: (rows: unknown[]) => rows })
  const foreign = { id: 'foreign-first', own: false }
  const legacy = { id: 'unproven-ownership' }
  const owned = { id: 'owned', own: true }
  assert.equal(select([foreign, legacy, owned]), owned.id, 'read visibility does not prove the owner-only act exists')
  assert.equal(select([owned, foreign]), owned.id, 'selection is independent of row order')
  assert.equal(select([foreign, legacy]), null, 'missing owner coverage stays explicit rather than probing a visitor')
  assert.equal(select([]), null)
})

test('sharing cells wait for the lazy-loaded act rather than judging its loading fallback', () => {
  const start = SWEEP.indexOf('async function sharingAct(')
  assert.ok(start >= 0)
  const body = SWEEP.slice(start, SWEEP.indexOf('\n/** Real ids', start))
  assert.match(body, /getByLabel\('Audience kind'\)\.waitFor\(\{ state: 'visible', timeout: 8000 \}\)/)
  assert.match(body, /note\(cell, 'UI-E19'/, 'a missing act still fails the sweep')
  assert.match(SWEEP, /await sharingAct\(page, cell, 'project'\)/)
  assert.match(SWEEP, /await sharingAct\(page, cell, 'routine'\)/)
})

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

test('the dock detector treats zero-size or pointer-disabled docks as closed', () => {
  const start = SWEEP.indexOf('const overlayDockLive')
  const end = SWEEP.indexOf('\n/** Close a docked panel', start)
  const source = SWEEP.slice(start, end)
  const callback = source.match(/page\.evaluate\(\(\) => \{([\s\S]*)\n  \}\)/)?.[1]
  assert.ok(callback, 'the live-dock callback remains extractable')
  const run = (dock: { width: number; height: number; pointerEvents: string } | null) => {
    const fn = vm.runInNewContext(`() => {${callback}}`, {
      document: { querySelector: () => dock && { getBoundingClientRect: () => dock } },
      getComputedStyle: () => ({ pointerEvents: dock?.pointerEvents ?? 'none' }),
    })
    return fn()
  }
  assert.equal(run(null), false, 'a missing dock is closed')
  assert.equal(run({ width: 300, height: 1024, pointerEvents: 'none' }), false, 'a pointer-disabled dock is closed')
  assert.equal(run({ width: 0, height: 1024, pointerEvents: 'auto' }), false, 'a zero-width dock is closed')
  assert.equal(run({ width: 300, height: 0, pointerEvents: 'auto' }), false, 'a zero-height dock is closed')
  assert.equal(run({ width: 300, height: 1024, pointerEvents: 'auto' }), true, 'a rendered hit-testable dock is live')
})

test('sweep dismissal waits for every exiting panel to unmount before capturing the conversation', () => {
  const start = SWEEP.indexOf('async function dismissOverlayPanel')
  const end = SWEEP.indexOf('async function openRailIfNarrow', start)
  assert.ok(start >= 0 && end > start)
  const dismiss = SWEEP.slice(start, end)
  assert.doesNotMatch(dismiss, /await tick\(/, 'elapsed time is not proof that a spring exit finished')
  const callback = dismiss.match(/page\.waitForFunction\(\(\) => \{([\s\S]*?)\n\s*\}, null, \{ timeout: 1500 \}\)/)?.[1]
  assert.ok(callback, 'panel disappearance has a bounded DOM-state wait')
  for (const children of [null, 0, 1, 2]) {
    const ready = vm.runInNewContext(`() => {${callback}}`, {
      document: { querySelector: () => children === null ? null : { childElementCount: children } },
    })
    assert.equal(ready(), children === null || children === 0,
      `a dock with ${children} children cannot be considered painted away merely because it is pointer-disabled`)
  }
})
