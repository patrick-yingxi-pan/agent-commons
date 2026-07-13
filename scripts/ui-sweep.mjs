/** The /ui-review mechanical sweep harness (`npm run ui:sweep`) — drives the
 *  RUNNING dev server through the full surface × viewport matrix and checks the
 *  machine-checkable rows of docs/ui-invariants.md per cell:
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
 *  Design rules, earned during the first /ui-review run (see the skill's
 *  gotchas, .claude/skills/ui-review/SKILL.md):
 *    • Open-only: popovers are opened and Escaped, never committed — the live
 *      store is not mutated (no sends, no menu-item picks).
 *    • Measure the container that animates: clipped children report their full
 *      layout rect, and "visible" ignores clipping/occlusion.
 *    • NO SILENT SKIPS: a cell or trigger the harness can't reach is recorded
 *      and printed — a quiet catch reports a clean cell it never visited.
 *
 *  Usage:  npm run dev   (in another terminal)
 *          npm run ui:sweep            # exits 1 on violations
 *  Env:    UI_SWEEP_BASE (default http://127.0.0.1:5173)
 *  Output: violations + skips as JSON; screenshots per cell in .data/ui-sweep/
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { sep } from 'node:path'

const BASE = process.env.UI_SWEEP_BASE ?? 'http://127.0.0.1:5173'
// fileURLToPath, not URL.pathname — the latter yields "/C:/…" on Windows, which
// resolves to a doubled drive prefix (C:\C:\…) and an ENOENT before the sweep runs.
const SHOTS = fileURLToPath(new URL('../.data/ui-sweep/', import.meta.url)) + sep
mkdirSync(SHOTS, { recursive: true })

const VIEWPORTS = [
  { name: '320x700', width: 320, height: 700, narrow: true },
  { name: '375x812', width: 375, height: 812, narrow: true },
  { name: '768x1024', width: 768, height: 1024, narrow: false },
  { name: '844x390', width: 844, height: 390, narrow: false },
  { name: '1280x800', width: 1280, height: 800, narrow: false },
]

const MARGIN = 7 // POPOVER_MARGIN − 1px rounding allowance

const violations = []
const skips = []
const note = (cell, invariant, detail) => {
  violations.push({ cell, invariant, detail })
  console.log(`VIOLATION [${cell}] ${invariant}: ${detail}`)
}
const skip = (cell, detail) => {
  skips.push({ cell, detail })
  console.log(`SKIP [${cell}]: ${detail}`)
}

const tick = (ms = 120) => new Promise((r) => setTimeout(r, ms))

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
  const triggers = scope.locator('[aria-haspopup]:visible')
  const n = await triggers.count()
  const seen = new Set()
  for (let i = 0; i < n; i++) {
    const t = triggers.nth(i)
    const label =
      (await t.getAttribute('aria-label').catch(() => null)) ||
      (await t.textContent().catch(() => null))?.trim().slice(0, 40) ||
      `trigger#${i}`
    if (seen.has(label)) continue
    seen.add(label)
    try {
      await t.click({ timeout: 1500, force: true })
    } catch (e) {
      skip(cell, `trigger "${label}" not clickable: ${e.message.split('\n')[0]}`)
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

const shot = (page, name) => page.screenshot({ path: `${SHOTS}${name}.png` }).catch(() => {})

/** The drawer's true state. Measure the OUTER overflow-hidden container — the
 *  one whose width animates to 0; the aside inside keeps its fixed layout width
 *  even when clipped (rects ignore ancestor overflow clips). */
const railOpen = (page) =>
  page.evaluate(() => {
    const c = document.querySelector('aside')?.closest('.overflow-hidden')
    return !!c && c.getBoundingClientRect().width > 40
  })

async function openRailIfNarrow(page, vp) {
  if (!vp.narrow || (await railOpen(page))) return
  await page.getByRole('button', { name: 'Expand sidebar' }).first().click({ timeout: 3000 })
  await tick(250)
}

async function closeRailIfNarrow(page, vp) {
  if (!vp.narrow || !(await railOpen(page))) return
  // Click the scrim sliver right of the drawer (drawer width ≤ vw − 56).
  await page.mouse.click(vp.width - 10, Math.floor(vp.height / 2))
  await tick(250)
}

async function pickNav(page, vp, name) {
  await openRailIfNarrow(page, vp)
  await page.getByRole('navigation').getByRole('button', { name }).first().click({ timeout: 4000 })
  await tick(250)
  await closeRailIfNarrow(page, vp)
}

// ── preflight: a dead server must fail loudly, not sweep a blank page ──
try {
  const res = await fetch(BASE)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
} catch (e) {
  console.error(`ui-sweep: dev server not reachable at ${BASE} (${e.message}) — run \`npm run dev\` first.`)
  process.exit(2)
}

const browser = await chromium.launch()
for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => note(`${vp.name}/*`, 'pageerror', e.message.split('\n')[0]))
  // A real dev boot gates the workspace behind sign-in (AUTH_GATE defaults on —
  // server/index.ts). Sign in as the flagship demo account (docs/demo-accounts.md)
  // via the API so the sweep lands in a populated world; a no-op on an ungated
  // or already-authenticated stack.
  await page.request
    .post(`${BASE}/api/v1/auth/login`, { data: { email: 'ada@acme.example', password: 'ada-demo-password' } })
    .catch(() => {})
  await page.goto(BASE)
  await page.getByRole('button', { name: 'Explore on my own' }).click({ timeout: 4000 }).catch(() => {})
  await tick(200)

  // ── UI-3 + UI-8 (narrow): in-flow toggle; the closed drawer is inert ──
  if (vp.narrow) {
    const toggle = page.getByRole('button', { name: 'Expand sidebar' })
    if (await toggle.isVisible().catch(() => false)) {
      const pos = await toggle.evaluate((el) => getComputedStyle(el).position)
      if (pos !== 'static') note(`${vp.name}/thread-demo`, 'UI-3', `rail toggle computed position ${pos}`)
    } else note(`${vp.name}/thread-demo`, 'UI-3', 'no in-flow rail toggle visible on narrow')
    const railInert = await page.evaluate(() => !!document.querySelector('aside')?.closest('[inert]'))
    if (!railInert) note(`${vp.name}/thread-demo`, 'UI-8', 'collapsed drawer content is not inert')
  }

  // ── cell: demo thread (composer popovers + the chip remove-confirm) ──
  let cell = `${vp.name}/thread-demo`
  await noHScroll(page, cell)
  await shot(page, cell.replace('/', '_'))
  await sweepTriggers(page, vp, cell)

  const chipX = page.locator('button[aria-label^="Remove"]').first()
  if (await chipX.count()) {
    // Open-only: Escape cancels the confirm; nothing is removed.
    await chipX.click({ force: true }).catch(() => {})
    await tick()
    for (const b of await measureSurfaces(page)) assertInside(cell, 'chip remove-confirm', b, vp)
    await page.keyboard.press('Escape')
    await tick(80)
  } else skip(cell, 'no removable chip on the demo thread')

  // ── cell: the rail / drawer (filter menus, row menus, recents flyout) ──
  cell = `${vp.name}/rail`
  await openRailIfNarrow(page, vp)
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
  await closeRailIfNarrow(page, vp)

  // ── cell: the seeded repo session (chips + auto-opened panel) ──
  cell = `${vp.name}/thread-repo`
  await openRailIfNarrow(page, vp)
  const repoRow = page.locator('aside').getByText('Refactor auth middleware').first()
  if (await repoRow.count()) {
    await repoRow.click({ timeout: 4000 })
    await tick(400)
    await closeRailIfNarrow(page, vp)
    await noHScroll(page, cell)
    await shot(page, cell.replace('/', '_'))
    const closeBtn = page.getByRole('button', { name: 'Close', exact: true }).first()
    if (await closeBtn.isVisible().catch(() => false)) await closeBtn.click().catch(() => {})
    await tick(200)
    await sweepTriggers(page, vp, cell)
  } else skip(cell, 'seeded session "Refactor auth middleware" not in the rail')

  // ── cell: a fresh draft ──
  cell = `${vp.name}/draft`
  await pickNav(page, vp, 'New session').catch((e) => skip(cell, `nav failed: ${e.message.split('\n')[0]}`))
  await noHScroll(page, cell)
  await shot(page, cell.replace('/', '_'))
  await sweepTriggers(page, vp, cell)

  // ── cells: the seven sections ──
  for (const section of ['Projects', 'Artifacts', 'Contexts', 'Agents', 'Scheduled', 'Dispatch', 'Customize']) {
    cell = `${vp.name}/${section.toLowerCase()}`
    try {
      await pickNav(page, vp, new RegExp(`^${section}`))
    } catch (e) {
      skip(cell, `could not open section: ${e.message.split('\n')[0]}`)
      continue
    }
    await noHScroll(page, cell)
    await shot(page, cell.replace('/', '_'))
    await sweepTriggers(page, vp, cell)
  }

  // ── cell: Scheduled detail (cadence + model editors live there) ──
  cell = `${vp.name}/scheduled-detail`
  await pickNav(page, vp, /^Scheduled/).catch(() => {})
  const routine = page.locator('main').getByText(/briefing|digest|triage|report|review/i).first()
  if (await routine.count()) {
    try {
      await routine.click({ timeout: 3000 })
      await tick(400)
      await noHScroll(page, cell)
      await shot(page, cell.replace('/', '_'))
      await sweepTriggers(page, vp, cell, page.locator('main'))
    } catch (e) {
      // A matched-but-unclickable row is itself suspicious (a zero-width or
      // covered title has been a real finding twice) — screenshot + loud skip.
      await shot(page, `${cell.replace('/', '_')}-FAILED`)
      skip(cell, `routine row matched but not clickable: ${e.message.split('\n')[0]}`)
    }
  } else skip(cell, 'no routine row matched — check the seeds or widen the pattern')

  // ── cell: the artifact viewer modal ──
  cell = `${vp.name}/artifact-viewer`
  await pickNav(page, vp, /^Artifacts/).catch(() => {})
  // Cards are click-target divs, not buttons — enter through a title text.
  const card = page.locator('main').getByText(/one-pager|spec|brief|plan|hero|report/i).first()
  if (await card.count()) {
    try {
      await card.click({ timeout: 3000 })
    } catch (e) {
      await shot(page, `${cell.replace('/', '_')}-FAILED`)
      skip(cell, `artifact title matched but not clickable: ${e.message.split('\n')[0]}`)
      await ctx.close()
      console.log(`--- ${vp.name} swept ---`)
      continue
    }
    await tick(500)
    const dlg = page.locator('[role="dialog"]:visible').first()
    if (await dlg.count()) {
      const b = await dlg.boundingBox()
      if (b && (b.y < 0 || b.y + b.height > vp.height + 1 || b.width > vp.width)) {
        note(cell, 'UI-6', `viewer modal [y ${Math.round(b.y)} h ${Math.round(b.height)}] exceeds ${vp.width}×${vp.height}`)
      }
      await shot(page, cell.replace('/', '_'))
      await page.keyboard.press('Escape')
    } else skip(cell, 'artifact click opened no dialog — check the entry locator')
  } else skip(cell, 'no artifact title matched — check the seeds or widen the pattern')

  await ctx.close()
  console.log(`--- ${vp.name} swept ---`)
}
await browser.close()

console.log(`\nRESULT: ${violations.length} violation(s), ${skips.length} skip(s)`)
if (skips.length) console.log('skips:', JSON.stringify(skips, null, 2))
if (violations.length) {
  console.log('violations:', JSON.stringify(violations, null, 2))
  process.exit(1)
}
