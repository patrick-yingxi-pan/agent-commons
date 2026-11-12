/** The /ui-review mechanical sweep harness (`npm run ui:sweep`) — drives the
 *  full surface × viewport matrix and checks the machine-checkable rows of
 *  docs/ui-invariants.md per cell:
 *
 *    UI-1  every popover opened via its aria-haspopup trigger lies inside the
 *          viewport (data-popover / role=menu / role=listbox boxes measured)
 *    UI-2  no horizontal scroll on any surface
 *    UI-3  the narrow rail toggle is in-flow (computed position: static)
 *    UI-8  overlay layers inert their covered content (spot-checked: the
 *          collapsed rail on narrow has an inert ancestor)
 *
 *  (UI-4/5/6/7's source-scan halves live in `node --test`, not here.)
 *
 *  Design rules, earned during the /ui-review runs (see the skill's gotchas,
 *  .claude/skills/ui-review/SKILL.md):
 *    • Open-only: popovers are opened and Escaped, never committed — the store
 *      is not mutated (no sends, no menu-item picks).
 *    • Measure the container that animates: clipped children report their full
 *      layout rect, and "visible" ignores clipping/occlusion.
 *    • COVERAGE IS THE HEADLINE CHECK. An unreachable cell is a VIOLATION, not
 *      a skip. The harness keeps a per-viewport ledger of cells it actually
 *      swept and, at the end of each column, converts every unswept cell into a
 *      COVERAGE violation. It was reporting "0 violations" while most of the
 *      narrow column never ran; a green line over an unrun matrix is the exact
 *      false confidence docs/ui-invariants.md exists to prevent. `skip()`
 *      survives only for SUB-checks inside a cell that did run (one unclickable
 *      trigger), never for a cell.
 *    • NO NAVIGATION ERROR IS FATAL. A timeout used to escape as an uncaught
 *      rejection and kill the whole run at the first narrow viewport — five
 *      columns lost, no RESULT line, a stack trace instead of a verdict. Every
 *      column now runs inside its own guard; a failure marks its cells unswept
 *      and the sweep moves on.
 *    • ADDRESS, don't click through. Cells are reached by their CANONICAL URL
 *      (ADAPT-15) and detail ids come from the API, not from pattern-matching
 *      seed prose. Clicking the rail meant opening the narrow tier's drawer,
 *      whose scrim then intercepted the next click. The only cell that still
 *      operates the drawer is the one whose SUBJECT is the drawer.
 *    • LEAVE NO OVERLAY BEHIND. On narrow, a session with an attached context
 *      auto-opens its context panel as a full-viewport takeover
 *      (OverlayPanelDock, ADAPT-11) — a z-30 layer over the whole thread,
 *      including the rail toggle, dismissible only by its own Close (Escape
 *      does not close it). A cell that walked away from an open panel stranded
 *      every later cell in the column. Cells return to a neutral address, and
 *      the rail helper dismisses a covering dock before it reaches for the
 *      toggle (`[data-overlay-dock]` is the stamp that makes it detectable).
 *    • ENUMERATE LIVE TRIGGERS, not indexes captured before interaction. Opening
 *      a rail menu can reconcile/collapse that rail branch, so later triggers
 *      move to lower indexes. A fixed `count` + increasing `nth(i)` silently
 *      skipped those moved controls and eventually tried to click a vanished
 *      last index. Each pass now selects the first still-live accessible label
 *      it has not exercised; DOM movement cannot turn coverage into a skip.
 *    • COVERAGE BOUNDARY: this sweep drives ONE account (Ada, whose world is
 *      populated), so it exercises full surfaces, never EMPTY ones. A sparse
 *      world is a different layout path — verified 2026-07-22 for Rei's Lab
 *      across eight sections at 320 and 375 (no h-scroll, every empty section
 *      renders legible copy) and locked at the DOM level by the no-activity
 *      walk in e2e/social-square.spec.ts. Widen here only if that stops holding.
 *
 *  Usage:  npm run ui:sweep          # boots its OWN stack; exits 1 on violations
 *          UI_SWEEP_BASE=http://127.0.0.1:5173 npm run ui:sweep   # existing server
 *  Env:    UI_SWEEP_BASE  drive an already-running server instead of booting one
 *          UI_SWEEP_PORT  the owned stack's UI port (default 5193; API is +1)
 *  Output: violations + skips as JSON; screenshots per cell in .data/ui-sweep/
 */
import { chromium } from 'playwright'
import { expect } from '@playwright/test'
import { mkdirSync, rmSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import { sep } from 'node:path'
import { CELLS, SECTIONS, createLedger } from './ui-sweep-ledger.mjs'

// fileURLToPath, not URL.pathname — the latter yields "/C:/…" on Windows, which
// resolves to a doubled drive prefix (C:\C:\…) and an ENOENT before the sweep runs.
const ROOT = fileURLToPath(new URL('../', import.meta.url))
const SHOTS = `${ROOT}.data${sep}ui-sweep${sep}`
mkdirSync(SHOTS, { recursive: true })

// ── the stack ───────────────────────────────────────────────────────────────
// Default: boot our OWN, on dedicated ports with an isolated store — the same
// reasoning as playwright.config.ts. A hand-run `npm run dev` is a shared,
// long-lived, mutable world: its store drifts (that is where "no project exists
// for this account" skips came from), its mode is whatever the developer last
// set, and the sweep's open-only discipline is the only thing keeping it clean.
// Booting makes `npm run ui:sweep` self-contained and repeatable.
// UI_SWEEP_BASE opts back into an existing server for the /ui-review workflow of
// checking the app you are actually looking at.
const EXTERNAL = process.env.UI_SWEEP_BASE ?? null
const PORT = Number(process.env.UI_SWEEP_PORT ?? 5193)
const BASE = EXTERNAL ?? `http://127.0.0.1:${PORT}`
const STORE = `.data${sep}ui-sweep-store.json`

const MARGIN = 7 // POPOVER_MARGIN − 1px rounding allowance

const VIEWPORTS = [
  { name: '320x700', width: 320, height: 700, narrow: true },
  { name: '375x812', width: 375, height: 812, narrow: true },
  { name: '768x1024', width: 768, height: 1024, narrow: false },
  { name: '844x390', width: 844, height: 390, narrow: false },
  { name: '1280x800', width: 1280, height: 800, narrow: false },
]

const violations = []
const skips = []
const note = (cell, invariant, detail) => {
  violations.push({ cell, invariant, detail })
  console.log(`VIOLATION [${cell}] ${invariant}: ${detail}`)
}
/** A SUB-check inside a cell that ran — visible, tolerated, never a cell's alibi. */
const skip = (cell, detail) => {
  skips.push({ cell, detail })
  console.log(`SKIP [${cell}]: ${detail}`)
}

// Silence about a cell is a violation, not a pass — the ledger (and the reason
// why a cell could not be reached) lives in scripts/ui-sweep-ledger.mjs.
const ledger = createLedger()
const covered = (cell) => ledger.covered(cell)
const unreachable = (cell, why) => ledger.unreachable(cell, why)
const firstLine = (e) => String(e?.message ?? e).split('\n')[0]

const tick = (ms = 120) => new Promise((r) => setTimeout(r, ms))

// ── boot / teardown ─────────────────────────────────────────────────────────
const portFree = (port) =>
  new Promise((resolve) => {
    const probe = createServer()
    probe.once('error', () => resolve(false))
    probe.once('listening', () => probe.close(() => resolve(true)))
    probe.listen(port, '127.0.0.1')
  })

/** Poll until the stack answers. `alive` lets a dead child cut the wait short —
 *  otherwise a boot that crashed in two seconds is reported two minutes later. */
async function waitForServer(url, ms, alive = () => true) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline && alive()) {
    try {
      if ((await fetch(url)).ok) return true
    } catch {
      /* not up yet */
    }
    await tick(300)
  }
  return false
}

let stack = null
let stackLog = ''
function killStack() {
  const child = stack
  stack = null
  if (!child) return
  if (process.platform === 'win32') {
    // SIGTERM on Windows terminates only the launcher; Vite and the mock backend
    // are its grandchildren and would keep holding the ports. /T kills the tree.
    // spawnSYNC, not spawn: this also runs from the 'exit' handler, which cannot
    // await anything — an async spawn there never launches, the tree leaks, and
    // the NEXT sweep dies on "port busy".
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  } else {
    try {
      process.kill(-child.pid, 'SIGTERM') // the detached process group
    } catch {
      child.kill('SIGTERM')
    }
  }
}
process.on('exit', killStack)
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130))

async function bootStack() {
  // Vite does NOT run strictPort here, so a busy UI port silently slides to the
  // next one — which is the backend's. Refuse rather than sweep a mystery stack.
  for (const p of [PORT, PORT + 1]) {
    if (!(await portFree(p))) {
      console.error(
        `ui-sweep: port ${p} is busy — a previous sweep may have leaked, or another stack is up.\n` +
          `          Free it, pick another with UI_SWEEP_PORT, or drive the running server with UI_SWEEP_BASE.`,
      )
      process.exit(2)
    }
  }
  rmSync(`${ROOT}${STORE}`, { force: true }) // a clean slate per run, like e2e/wipe-store.mjs
  console.log(`ui-sweep: booting an isolated stack on :${PORT} (API :${PORT + 1}, store ${STORE})`)
  stack = spawn(process.execPath, [`${ROOT}scripts${sep}dev.mjs`], {
    cwd: ROOT,
    detached: process.platform !== 'win32', // its own process group, so we can kill the tree
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PORT: String(PORT),
      DATA_FILE: STORE,
      // Pin the model seam to the in-process mock: an ambient ANTHROPIC_BASE_URL
      // (a coding agent's harness often exports api.anthropic.com) would stand the
      // mock down and dial a real API. Same reasoning as playwright.config.ts.
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:8788',
      // The auth gate stays ON — the sweep signs in as Ada, so the gated front
      // door is part of what it exercises. Pinned to the exact string the
      // server tests for (`AUTH_GATE === 'require'`, server/store/index.ts): ANY other
      // value, an ambient `off` included, means OFF, so this can be neither
      // inherited nor spelled loosely.
      AUTH_GATE: 'require',
      // The owned matrix exercises the full conditional section, not merely
      // its denied deep-link face. External-stack sweeps remain truthful to
      // whatever deployment capability they are actually driving.
      MAINTAINERS: 'user-ada',
      // The owned sweep stack never edits source while it runs. Keep the
      // interactive dev launcher's hot reload, but do not spend file handles on
      // a recursive backend watcher here.
      SERVER_WATCH: 'off',
    },
  })
  const keep = (chunk) => {
    stackLog = (stackLog + chunk).slice(-4000)
  }
  stack.stdout.on('data', keep)
  stack.stderr.on('data', keep)
  stack.on('exit', (code) => {
    if (stack) console.error(`ui-sweep: the stack exited early (${code})\n${stackLog}`)
    stack = null
  })
  // Wait on the API, not the UI. Vite answers `/` the moment it binds, while the
  // mock backend is a SEPARATE process still starting — so waiting on the UI
  // alone let the first requests hit a dead proxy target (a 500 from `/api/v1/*`).
  // The sign-in POST swallows its errors, so that race could have landed a whole
  // sweep of the ANONYMOUS world with nothing in the log to say so. `/me` is an
  // open front-door route: 200 means both processes are up.
  if (!(await waitForServer(`${BASE}/api/v1/me`, 120_000, () => stack !== null))) {
    console.error(`ui-sweep: the stack never came up at ${BASE}\n${stackLog}`)
    killStack()
    process.exit(2)
  }
  // Prove the gate is actually on before sweeping behind it. `AUTH_GATE` counts
  // as on ONLY for the exact string 'require', so a plausible-looking value ('on')
  // silently opens the door — and every cell would then render the ANONYMOUS
  // principal's world while the log still said the sweep signed in as Ada. A
  // harness that measures a different app than it claims is the same failure as
  // one that measures no app at all.
  const anon = await fetch(`${BASE}/api/v1/sessions`)
  if (anon.status !== 401) {
    console.error(`ui-sweep: the stack is NOT gated (anonymous GET /sessions → ${anon.status}, expected 401) — refusing to sweep an unsigned-in world.`)
    killStack()
    process.exit(2)
  }
}

if (EXTERNAL) {
  // A dead server must fail loudly, not sweep a blank page.
  try {
    const res = await fetch(BASE)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
  } catch (e) {
    console.error(`ui-sweep: no server at ${BASE} (${firstLine(e)}) — run \`npm run dev\`, or drop UI_SWEEP_BASE to boot one.`)
    process.exit(2)
  }
  console.log(`ui-sweep: driving the existing server at ${BASE}`)
} else {
  await bootStack()
}

// ── checks ──────────────────────────────────────────────────────────────────
async function noHScroll(page, cell) {
  const [sw, cw] = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    document.documentElement.clientWidth,
  ])
  if (sw > cw) note(cell, 'UI-2', `horizontal scroll: scrollWidth ${sw} > clientWidth ${cw}`)
}

/** Measure every floating surface currently in the DOM against the viewport. */
async function measureSurfaces(page) {
  return page.evaluate(() => {
    const sel = '[data-popover], [role="menu"], [role="listbox"]'
    return [...document.querySelectorAll(sel)]
      .filter((el) => el.offsetParent !== null || getComputedStyle(el).position === 'fixed')
      .map((el) => {
        const r = el.getBoundingClientRect()
        return {
          tag: el.getAttribute('aria-label') || el.tagName,
          left: Math.round(r.left), right: Math.round(r.right),
          top: Math.round(r.top), bottom: Math.round(r.bottom),
          w: Math.round(r.width), h: Math.round(r.height),
        }
      })
      .filter((m) => m.w > 0 && m.h > 0)
  })
}

function assertInside(cell, label, b, vp) {
  const inside =
    b.left >= MARGIN && b.right <= vp.width - MARGIN && b.top >= MARGIN && b.bottom <= vp.height - MARGIN
  if (!inside) {
    note(cell, 'UI-1', `"${label}" → "${b.tag}" [${b.left},${b.top}→${b.right},${b.bottom}] outside ${vp.width}×${vp.height}`)
  }
}

/** Click every visible aria-haspopup trigger in `scope`, one at a time; assert
 *  each surfaced popover is inside the viewport; Escape to close. */
async function sweepTriggers(page, vp, cell, scope = page) {
  await page.waitForFunction(deferredSurfaceReady, null, { timeout: 8000 })
  const triggers = scope.locator('[aria-haspopup]:visible')
  const seen = new Set()
  while (true) {
    let t = null
    let label = null
    const liveCount = await triggers.count()
    for (let i = 0; i < liveCount; i++) {
      const candidate = triggers.nth(i)
      const candidateLabel =
        (await candidate.getAttribute('aria-label').catch(() => null)) ||
        (await candidate.getAttribute('title').catch(() => null)) ||
        (await candidate.textContent().catch(() => null))?.trim().slice(0, 40) ||
        `unnamed-trigger#${i}`
      if (seen.has(candidateLabel)) continue
      t = candidate
      label = candidateLabel
      break
    }
    if (!t || !label) break
    seen.add(label)
    try {
      await t.click({ timeout: 1500, force: true })
    } catch (e) {
      skip(cell, `trigger "${label}" not clickable: ${firstLine(e)}`)
      continue
    }
    await tick()
    const boxes = await measureSurfaces(page)
    if (boxes.length === 0) {
      const expanded = await t.getAttribute('aria-expanded').catch(() => null)
      const dialog = await page.locator('[role="dialog"]:visible').count()
      if (expanded === 'true' && !dialog) {
        note(cell, 'UI-1', `"${label}" expanded but no measurable popover/menu/dialog appeared`)
      }
    }
    for (const b of boxes) assertInside(cell, label, b, vp)
    await page.keyboard.press('Escape')
    await tick(80)
    if ((await measureSurfaces(page)).length) {
      // escape:false popovers dismiss on outside click — the bottom-right
      // corner is the composer disclaimer / dead space on every surface.
      await page.mouse.click(vp.width - 3, vp.height - 3)
      await tick(80)
    }
  }
}

/** Reveal motion can leave readable transcript rows faded or blurred in an
 * otherwise ready workspace. Match the E2E opaque-paint gate for every rendered
 * conversation, resampling row identity as well as geometry after two frames. */
async function settledConversationPaint() {
  const paint = () => {
    const snapshot = []
    for (const row of document.querySelectorAll('[data-conversation-pane] [data-turn]')) {
      if (!row.isConnected) return null
      const { x, y, width, height } = row.getBoundingClientRect()
      if (width === 0 || height === 0 || getComputedStyle(row).visibility !== 'visible') continue
      for (let node = row; node; node = node.parentElement) {
        if (getComputedStyle(node).opacity !== '1') return null
      }
      snapshot.push({ row, rect: JSON.stringify([x, y, width, height]) })
    }
    return snapshot
  }
  const before = paint()
  if (!before) return false
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  const after = paint()
  return !!after && before.length === after.length && before.every((entry, index) =>
    entry.row === after[index].row && entry.rect === after[index].rect)
}

async function shot(page, name) {
  await page.waitForFunction(deferredSurfaceReady, null, { timeout: 8000 })
  // waitForFunction treats an async predicate's Promise as truthy before it
  // resolves. Poll the awaited two-frame result so false keeps capture held.
  await expect.poll(() => page.evaluate(settledConversationPaint), { timeout: 8000 }).toBe(true)
  return page.screenshot({ path: `${SHOTS}${name}.png` })
}

// ── navigation (loud, never fatal) ──────────────────────────────────────────
/** The drawer's true state. Measure the OUTER overflow-hidden container — the
 *  one whose width animates to 0; the aside inside keeps its fixed layout width
 *  even when clipped (rects ignore ancestor overflow clips). */
const railOpen = (page) =>
  page.evaluate(() => {
    const c = document.querySelector('aside')?.closest('.overflow-hidden')
    return !!c && c.getBoundingClientRect().width > 40
  })

/** Is a context panel docked OVER the thread and eating pointer events? On the
 *  narrow tier OverlayPanelDock spans the whole thread (ADAPT-11) and stays
 *  mounted while empty; on medium it can remain mounted at zero size after
 *  closing. Presence is therefore not enough: require rendered dimensions and
 *  hit-testing. */
const overlayDockLive = (page) =>
  page.evaluate(() => {
    const d = document.querySelector('[data-overlay-dock]')
    if (!d || getComputedStyle(d).pointerEvents === 'none') return false
    const { width, height } = d.getBoundingClientRect()
    return width > 0 && height > 0
  })

/** Close a docked panel. It is NOT a popover: Escape does not dismiss it and it
 *  has no scrim on narrow (it is a full takeover), so its own Close is the only
 *  exit — and until it is taken, the toggle underneath is unclickable. */
async function dismissOverlayPanel(page) {
  if (await overlayDockLive(page)) {
    const close = page.locator('[data-overlay-dock]').getByRole('button', { name: 'Close', exact: true }).first()
    if (!(await close.count())) return false
    try { await close.click({ timeout: 1500 }) } catch { return false }
  }
  try {
    // Narrow exits stop intercepting immediately but remain painted; medium
    // exits keep their shrinking width until AnimatePresence removes them.
    // Capture neither halfway through a spring, even if Close already worked.
    await page.waitForFunction(() => {
      const dock = document.querySelector('[data-overlay-dock]')
      return !dock || dock.childElementCount === 0
    }, null, { timeout: 1500 })
    return !(await overlayDockLive(page))
  } catch { return false }
}

async function openRailIfNarrow(page, vp, cell) {
  if (!vp.narrow || (await railOpen(page))) return true
  if (!(await dismissOverlayPanel(page))) {
    note(cell, 'COVERAGE', 'a docked context panel covers the rail toggle and would not close')
    return false
  }
  try {
    await page.getByRole('button', { name: 'Expand sidebar' }).first().click({ timeout: 3000 })
  } catch (e) {
    note(cell, 'COVERAGE', `the rail drawer would not open: ${firstLine(e)}`)
    return false
  }
  await tick(250)
  return true
}

async function closeRailIfNarrow(page, vp) {
  if (!vp.narrow || !(await railOpen(page))) return
  // Click the scrim sliver right of the drawer (drawer width ≤ vw − 56).
  await page.mouse.click(vp.width - 10, Math.floor(vp.height / 2))
  await tick(250)
}

/** The shell mounts before its lazy body. Only the focused pane's visible
 * resource page is reviewable; conversations and drafts use that same frame.
 * Normal empty pages qualify, but loading, failed and unavailable substitutes
 * cannot satisfy a cell that promises the actual subject. Runs in the browser. */
function surfaceReady() {
  const pane = document.querySelector('main [data-main-pane][data-focused="true"]')
  if (!pane || pane.querySelector('[data-section-loading], [data-section-load-error], [data-resource-unavailable]')) return false
  const surface = pane.querySelector('[data-resource-page]')
  if (!surface) return false
  const { width, height } = surface.getBoundingClientRect()
  return width > 0 && height > 0 && getComputedStyle(surface).visibility === 'visible'
}

/** These nested modules mount after the page frame. Wait for the requested,
 * rendered controls, including their data read, without waiting for unrelated
 * live statuses or hidden optional sections. Runs in the browser. */
function deferredSurfaceReady() {
  const pane = document.querySelector('main [data-main-pane][data-focused="true"]')
  if (!pane) return true
  return [...pane.querySelectorAll('[role="status"], [role="alert"], [data-proposals-load]')].every(status => {
    const { width, height } = status.getBoundingClientRect()
    if (width === 0 || height === 0 || getComputedStyle(status).visibility !== 'visible') return true
    const text = status.textContent?.trim() ?? ''
    return !status.hasAttribute('data-proposals-load') &&
      !/^Loading (?:requests|improvements|backup controls)…$/.test(text) &&
      !/^Couldn’t (?:load request history|read current request access|load improvements|load backup controls)\./.test(text)
  })
}

/** A visible repository panel must contain its real diff body, not just the
 * shared lazy shell. Closed narrow docks and unrelated panes are not subjects. */
function repoPanelsReady(sessionId) {
  return [...document.querySelectorAll('[data-context-pane], [data-overlay-dock]')].every((panel) => {
    const identity = panel.getAttribute('data-context-pane')
    if (identity && !identity.startsWith(`${sessionId} repo `)) return true
    const { width, height } = panel.getBoundingClientRect()
    if (width === 0 || height === 0 || getComputedStyle(panel).pointerEvents === 'none') return true
    return !panel.querySelector('[data-workspace-panel-load]') && !!panel.querySelector('[aria-label="Code changes"]')
  })
}

/** Land on a page by its CANONICAL URL. Every page has one (ADAPT-15,
 *  src/lib/urlRoutes.ts), so the sweep addresses a surface directly instead of
 *  clicking through the rail — which at the narrow tier means opening a drawer
 *  whose scrim then intercepts the next click. That drawer path produced an
 *  entire column's worth of false skips. Rail navigation itself is covered by
 *  e2e/responsive.spec.ts and e2e/back-history.spec.ts, not here.
 *  Returns false (and records the cell unreachable) if the address renders no
 *  workspace — a blank page must not be swept and reported clean. */
async function goTo(page, path, cell) {
  try {
    await page.goto(`${BASE}${path}`)
  } catch (e) {
    unreachable(cell, `${path} failed to load: ${firstLine(e)}`)
    return false
  }
  // Main chrome exists during lazy loading. Require its real body before any
  // caller measures, captures or marks this cell covered, within the same budget.
  try {
    const readyDeadline = Date.now() + 8000
    await page.waitForFunction(surfaceReady, null, { timeout: 8000 })
    await page.waitForFunction(deferredSurfaceReady, null, { timeout: Math.max(1, readyDeadline - Date.now()) })
  } catch {
    unreachable(cell, `${path} exposed no ready focused resource page in 8s — the workspace was absent, hidden, loading or unavailable`)
    return false
  }
  return true
}

/** The sharing editor is lazy-loaded. A visible workspace can still contain
 * its loading fallback, so wait for the actual act before judging this cell. */
async function sharingAct(page, cell, subject) {
  try {
    await page.getByLabel('Audience kind').waitFor({ state: 'visible', timeout: 8000 })
  } catch {
    note(cell, 'UI-E19', `the canonical ${subject} Sharing page did not expose its sharing act`)
  }
}

/** Real ids from the API the UI reads, so a detail cell can never miss with
 *  "check the seeds or widen the pattern" — the harness asks the backend what
 *  exists instead of pattern-matching seed prose that drifts. */
async function seedIds(page) {
  const get = async (p) => {
    try {
      const r = await page.request.get(`${BASE}/api/v1${p}`)
      return r.ok() ? await r.json() : []
    } catch {
      return []
    }
  }
  const arr = (v) => (Array.isArray(v) ? v : (v?.items ?? []))
  const [projects, schedules, artifacts, discussions, sessions, me] = await Promise.all([
    get('/projects'),
    get('/schedules'),
    get('/artifacts'),
    get('/discussions?mine=1'),
    get('/sessions'),
    get('/me'),
  ])
  // Sessions that actually HAVE an attached context: the chip remove-confirm can
  // only be swept where a chip exists (the demo thread has none, so that check
  // silently skipped on every viewport for as long as it existed), and the
  // chips-plus-panel cell needs a repo. Ask rather than assume.
  let chipSessionId = null
  let repoSessionId = null
  let repoLabel = null
  let threadSessionId = null
  let threadSessionTitle = null
  for (const row of arr(sessions).slice(0, 14)) {
    const d = await get(`/sessions/${row.id}`)
    const w = d?.workspace ?? {}
    const n = (w.workspaces?.length ?? 0) + (w.repos?.length ?? 0) + (w.connectors?.length ?? 0) + (w.attachments?.length ?? 0)
    if (n > 0) chipSessionId ??= row.id
    if (!repoSessionId && (w.repos?.length ?? 0) > 0) {
      repoSessionId = row.id
      repoLabel = w.repos[0].label
    }
    if (!threadSessionId && (w.repos?.length ?? 0) === 0 && Array.isArray(d?.messages) && d.messages.length > 0) {
      threadSessionId = row.id
      threadSessionTitle = d.title ?? row.title
    }
    if (chipSessionId && repoSessionId && threadSessionId) break
  }
  return {
    chipSessionId,
    repoSessionId,
    repoLabel,
    threadSessionId,
    threadSessionTitle,
    // The canonical registry includes foreign shared/granted rows. The owner
    // sharing act requires write-grade ownership, never just list visibility.
    projectId: arr(projects).find((project) => project.own === true)?.id ?? null,
    scheduleId: arr(schedules)[0]?.id ?? null,
    artifactId: arr(artifacts)[0]?.id ?? null,
    discussionId: arr(discussions)[0]?.id ?? null,
    ownerName: me?.tenant?.name ?? null,
  }
}

// ── the sweep ───────────────────────────────────────────────────────────────
const browser = await chromium.launch()
for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } })
  const page = await ctx.newPage()
  // Keep bounded lifecycle evidence: a navigation can destroy evaluate()'s
  // context, and its first-line error alone cannot distinguish product routing
  // from Vite reloading. Never record request bodies, headers, or URL queries.
  const lifecycle = []
  const recordLifecycle = (event) => {
    lifecycle.push(`${new Date().toISOString()} ${event}`)
    if (lifecycle.length > 40) lifecycle.shift()
  }
  page.on('console', (message) => {
    if (message.text().startsWith('[vite]')) recordLifecycle(message.text())
  })
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) recordLifecycle(`navigate ${new URL(frame.url()).pathname}`)
  })
  page.on('pageerror', (e) => note(`${vp.name}/*`, 'pageerror', firstLine(e)))
  const at = (name) => `${vp.name}/${name}`

  // One guard per column. Before this, a single click timeout escaped as an
  // uncaught rejection and killed the process at the FIRST narrow viewport —
  // four later columns never ran and the run ended with a stack trace instead of
  // a verdict. Now the column's remaining cells report as unswept and the sweep
  // carries on to the next viewport.
  try {
    // A real dev boot gates the workspace behind sign-in (AUTH_GATE defaults on —
    // server/index.ts). Sign in as the flagship demo account (docs/demo-accounts.md)
    // via the API so the sweep lands in a populated world; a no-op on an ungated
    // or already-authenticated stack.
    await page.request
      .post(`${BASE}/api/v1/auth/login`, { data: { email: 'ada@acme.example', password: 'ada-demo-password' } })
      .catch(() => {})
    if (!EXTERNAL) {
      const me = await page.request.get(`${BASE}/api/v1/me`).then((response) => response.json()).catch(() => null)
      if (me?.instanceAdmin !== true) {
        note(at('admin'), 'COVERAGE', 'the owned stack did not grant Ada the full maintainer surface')
      }
    }
    await page.goto(BASE)
    await page.getByRole('button', { name: 'Explore on my own' }).click({ timeout: 4000 }).catch(() => {})
    await tick(200)

    const ids = await seedIds(page)

    // ── UI-3 + UI-8 (narrow): in-flow toggle; the closed drawer is inert ──
    if (vp.narrow) {
      const toggle = page.getByRole('button', { name: 'Expand sidebar' })
      if (await toggle.isVisible().catch(() => false)) {
        const pos = await toggle.evaluate((el) => getComputedStyle(el).position)
        if (pos !== 'static') note(at('thread-demo'), 'UI-3', `rail toggle computed position ${pos}`)
      } else note(at('thread-demo'), 'UI-3', 'no in-flow rail toggle visible on narrow')
      const railInert = await page.evaluate(() => !!document.querySelector('aside')?.closest('[inert]'))
      if (!railInert) note(at('thread-demo'), 'UI-8', 'collapsed drawer content is not inert')
    }

    // ── cell: demo thread (composer popovers) ──
    let cell = at('thread-demo')
    if (ids.threadSessionId && ids.threadSessionTitle) {
      if (await goTo(page, `/s/${ids.threadSessionId}`, cell)) {
        try {
          await page.getByRole('heading', { name: ids.threadSessionTitle, exact: true }).waitFor({ state: 'visible', timeout: 8000 })
          await page.locator('[data-turn]').first().waitFor({ state: 'visible', timeout: 8000 })
          if (!(await dismissOverlayPanel(page)) || (await overlayDockLive(page))) {
            throw new Error('a restored context overlay did not close before the thread screenshot')
          }
          await noHScroll(page, cell)
          await shot(page, cell.replace('/', '_'))
          await sweepTriggers(page, vp, cell)
          covered(cell)
        } catch (e) {
          unreachable(cell, `populated session ${ids.threadSessionId} did not expose its title and transcript: ${firstLine(e)}`)
        }
      }
    } else unreachable(cell, 'no populated ordinary conversation session detail')

    // ── cell: the chip remove-confirm, on a session that HAS a chip ──
    cell = at('chip-confirm')
    if (ids.chipSessionId) {
      if (await goTo(page, `/s/${ids.chipSessionId}`, cell)) {
        const chipX = page.locator('button[aria-label^="Remove"]').first()
        if (await chipX.count()) {
          let confirmed = false
          try {
            if (!(await dismissOverlayPanel(page))) throw new Error('a docked context panel would not close')
            // The remove affordance is hover-revealed. Use a real hit-tested
            // click so a covered/disabled control cannot produce a false green.
            await chipX.scrollIntoViewIfNeeded()
            await chipX.hover({ timeout: 1500 })
            await chipX.focus()
            const ariaLabel = await chipX.getAttribute('aria-label')
            const labelMatch = ariaLabel?.match(/^Remove (.+) from the conversation$/)
            if (!labelMatch) throw new Error(`remove control has no conversation label: ${ariaLabel ?? 'missing aria-label'}`)
            await chipX.click({ timeout: 1500 })
            await tick()
            const escapedLabel = labelMatch[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
            const confirm = page
              .locator('[data-popover]:visible')
              .filter({ hasText: new RegExp(`Remove ${escapedLabel}(?: from the conversation)?\\?`) })
              .filter({ hasText: 'Cancel' })
              .first()
            await confirm.waitFor({ state: 'visible', timeout: 3000 })
            const boxes = await measureSurfaces(page)
            if (!boxes.length) throw new Error('the remove confirmation opened without a measurable popover')
            for (const b of boxes) assertInside(cell, 'chip remove-confirm', b, vp)
            await shot(page, cell.replace('/', '_'))
            confirmed = true
          } catch (e) {
            unreachable(cell, `the chip remove-confirm did not open: ${firstLine(e)}`)
          }
          // Open-only: Escape cancels the confirm; nothing is removed.
          await page.keyboard.press('Escape').catch(() => {})
          await tick(80)
          if (confirmed) covered(cell)
        } else unreachable(cell, `session ${ids.chipSessionId} reports a context but renders no remove control`)
      }
    } else unreachable(cell, 'no session with an attached context')

    // ── cell: the rail / drawer (filter menus, row menus, recents flyout) ──
    // Back to a neutral address first: on narrow the session above leaves its
    // context panel docked over the whole thread, toggle included.
    cell = at('rail')
    if ((await goTo(page, '/', cell)) && (await openRailIfNarrow(page, vp, cell))) {
      await shot(page, cell.replace('/', '_'))
      await sweepTriggers(page, vp, cell, page.locator('aside'))
      const more = page.locator('aside button', { hasText: 'More recent' }).first()
      if (await more.count()) {
        await more.hover().catch(() => {})
        await tick(400)
        for (const b of await measureSurfaces(page)) assertInside(cell, 'recents flyout', b, vp)
        await page.mouse.move(5, 5)
        await tick(300)
      }
      covered(cell)
      await closeRailIfNarrow(page, vp)
    }

    // ── cell: a seeded repo session (chips + the auto-opened panel) ──
    cell = at('thread-repo')
    if (ids.repoSessionId && ids.repoLabel) {
      if (await goTo(page, `/s/${ids.repoSessionId}`, cell)) {
        try {
          const conversation = page.locator(`[data-conversation-pane="${ids.repoSessionId}"]`)
          await conversation.locator('[data-turn]').first().waitFor({ state: 'visible', timeout: 8000 })
          await conversation.getByRole('button', { name: ids.repoLabel, exact: true }).waitFor({ state: 'visible', timeout: 8000 })
          await page.waitForFunction(repoPanelsReady, ids.repoSessionId, { timeout: 8000 })
          await noHScroll(page, cell)
          await shot(page, cell.replace('/', '_'))
          await dismissOverlayPanel(page) // measure the thread, then leave it clean
          const closeBtn = page.getByRole('button', { name: 'Close', exact: true }).first()
          if (await closeBtn.isVisible().catch(() => false)) await closeBtn.click().catch(() => {})
          await tick(200)
          await sweepTriggers(page, vp, cell)
          covered(cell)
        } catch (e) {
          unreachable(cell, `repo session ${ids.repoSessionId} did not expose its transcript, chip and ready panel: ${firstLine(e)}`)
        }
      }
    } else unreachable(cell, 'no session with an attached repo')

    // ── cell: a fresh draft ──
    cell = at('draft')
    if (await goTo(page, '/sessions', cell)) {
      try {
        if (!(await openRailIfNarrow(page, vp, cell))) throw new Error('the rail could not open for the Create navigation')
        await page.locator('aside').getByRole('navigation', { name: 'Create', exact: true }).getByRole('button', { name: 'New session', exact: true }).click({ timeout: 4000 })
        await closeRailIfNarrow(page, vp)
        await page.locator('[data-conversation-pane="draft"]').waitFor({ state: 'visible', timeout: 8000 })
        await page.getByRole('heading', { name: 'New session', exact: true }).waitFor({ state: 'visible', timeout: 8000 })
        const turns = await page.locator('[data-turn]').count()
        if (turns !== 0) throw new Error(`fresh draft exposed ${turns} transcript turns`)
        await noHScroll(page, cell)
        await shot(page, cell.replace('/', '_'))
        await sweepTriggers(page, vp, cell)
        covered(cell)
      } catch (e) {
        unreachable(cell, `fresh New session did not expose an empty draft: ${firstLine(e)}`)
      }
    }

    // ── cells: the rail sections (incl. the social layer's Commons + Discussions) ──
    for (const section of SECTIONS) {
      cell = at(section)
      if (!(await goTo(page, `/${section}`, cell))) continue
      await noHScroll(page, cell)
      await shot(page, cell.replace('/', '_'))
      await sweepTriggers(page, vp, cell)
      covered(cell)
    }

    // ── the DETAIL cells, addressed by canonical URL from real ids ──
    cell = at('project-detail')
    if (ids.projectId) {
      if (await goTo(page, `/projects/${ids.projectId}`, cell)) {
        await noHScroll(page, cell)
        await shot(page, cell.replace('/', '_'))
        await sweepTriggers(page, vp, cell, page.locator('main'))
        covered(cell)
      }
    } else unreachable(cell, 'no project exists for this account')

    // A canonical act page must expose the act itself at every tier. The
    // overview above intentionally keeps this form disclosed (UI-18); measuring
    // only that host is how the formerly blank direct page escaped the matrix.
    cell = at('project-sharing')
    if (ids.projectId) {
      if (await goTo(page, `/projects/${ids.projectId}/sharing`, cell)) {
        await noHScroll(page, cell)
        await sharingAct(page, cell, 'project')
        await shot(page, cell.replace('/', '_'))
        await sweepTriggers(page, vp, cell, page.locator('main'))
        covered(cell)
      }
    } else unreachable(cell, 'no project exists for this account')

    // The routine page carries the social panels: the Sharing rail's grant form,
    // Improvements, Discussion, and the per-run locus gutters.
    cell = at('scheduled-detail')
    if (ids.scheduleId) {
      if (await goTo(page, `/scheduled/${ids.scheduleId}`, cell)) {
        await noHScroll(page, cell)
        await shot(page, cell.replace('/', '_'))
        await sweepTriggers(page, vp, cell, page.locator('main'))
        covered(cell)
      }
    } else unreachable(cell, 'no routine exists for this account')

    cell = at('scheduled-sharing')
    if (ids.scheduleId) {
      if (await goTo(page, `/scheduled/${ids.scheduleId}/sharing`, cell)) {
        await noHScroll(page, cell)
        await sharingAct(page, cell, 'routine')
        await shot(page, cell.replace('/', '_'))
        await sweepTriggers(page, vp, cell, page.locator('main'))
        covered(cell)
      }
    } else unreachable(cell, 'no routine exists for this account')

    // A thread page — the anchor chip, the post list's react/delete/report row.
    cell = at('discussion-detail')
    if (ids.discussionId) {
      if (await goTo(page, `/discussions/${ids.discussionId}`, cell)) {
        await noHScroll(page, cell)
        await shot(page, cell.replace('/', '_'))
        await sweepTriggers(page, vp, cell, page.locator('main'))
        covered(cell)
      }
    } else unreachable(cell, 'no discussion visible to this account')

    // ── cell: the artifact's canonical main page (including Sharing) ──
    cell = at('artifact-page')
    if (ids.artifactId) {
      if (await goTo(page, `/artifacts/${ids.artifactId}`, cell)) {
        const artifactPage = page.locator(`[data-artifact-page="${ids.artifactId}"]`)
        const ready = await artifactPage.waitFor({ state: 'visible', timeout: 8000 }).then(() => true, () => false)
        if (ready) {
          if (await page.locator('[role="dialog"]:visible').count()) {
            note(cell, 'UI-29', 'the canonical artifact URL rendered a dialog instead of the pane main page')
          }
          await noHScroll(page, cell)
          await shot(page, cell.replace('/', '_'))
          await sweepTriggers(page, vp, cell, artifactPage)
          covered(cell)
        } else unreachable(cell, `artifact ${ids.artifactId} did not render its canonical main page`)
      }
    } else unreachable(cell, 'no artifact exists for this account')

    // A namespace profile is a composite just like a Project: its root and a
    // structural section are separate cells, and the active profile address
    // also exposes the mirrored rail branch. Keep the rail screenshot distinct
    // on narrow viewports so opening the drawer cannot overwrite the main page.
    cell = at('profile-detail')
    if (ids.ownerName) {
      const ownerPath = `/u/${encodeURIComponent(ids.ownerName)}`
      if (await goTo(page, ownerPath, cell)) {
        await noHScroll(page, cell)
        await shot(page, cell.replace('/', '_'))
        await sweepTriggers(page, vp, cell, page.locator('main'))
        if (await openRailIfNarrow(page, vp, cell)) {
          if (vp.narrow) await shot(page, `${cell.replace('/', '_')}_rail`)
          covered(cell)
          await closeRailIfNarrow(page, vp)
        }
      }
    } else unreachable(cell, 'the signed-in account has no namespace name')

    cell = at('profile-section')
    if (ids.ownerName) {
      const networkPath = `/u/${encodeURIComponent(ids.ownerName)}/network`
      if (await goTo(page, networkPath, cell)) {
        await noHScroll(page, cell)
        await shot(page, cell.replace('/', '_'))
        await sweepTriggers(page, vp, cell, page.locator('main'))
        covered(cell)
      }
    } else unreachable(cell, 'the signed-in account has no namespace name')
  } catch (e) {
    note(`${vp.name}/*`, 'COVERAGE', `the column aborted: ${firstLine(e)}`)
    console.error(`ui-sweep: ${vp.name} lifecycle diagnostics\n${e?.stack ?? e}\n${lifecycle.join('\n')}\n${stackLog}`)
  } finally {
    // The ledger closes the column: silence about a cell is a violation, not a pass.
    for (const v of ledger.close(vp.name)) note(v.cell, v.invariant, v.detail)
    await ctx.close()
  }
  console.log(`--- ${vp.name} swept ---`)
}
await browser.close()
killStack()

const total = VIEWPORTS.length * CELLS.length
console.log(`\nRESULT: ${violations.length} violation(s), ${skips.length} skip(s), ${ledger.size}/${total} cells swept`)
if (skips.length) console.log('skips:', JSON.stringify(skips, null, 2))
if (violations.length) {
  console.log('violations:', JSON.stringify(violations, null, 2))
  process.exit(1)
}
