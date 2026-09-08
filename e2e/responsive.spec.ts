/** Responsive layout ladder (FWD-3 / PD35) — the browser-level lock for the
 *  narrow / medium / short tiers that node --test can't exercise (no DOM):
 *
 *    375×812 (phone portrait) — the rail starts CLOSED and opens as an
 *      off-canvas drawer over a scrim; picking a session dismisses it; the
 *      composer sends; a context chip's panel takes over the full viewport;
 *      and nothing ever scrolls horizontally.
 *    768×1024 (tablet) — the right panel overlays the thread behind a scrim
 *      (the pre-existing medium behavior) and the scrim click dismisses it.
 *    844×390 (phone landscape, `short`) — the chrome compresses (composer
 *      disclaimer hidden) and the thread + composer stay usable.
 *
 *  One spec with setViewportSize rather than a second Playwright project: the
 *  harness runs workers:1 over one shared backend, so a per-viewport project
 *  would re-boot the webServer and roughly double the suite's runtime. */
import { test, expect, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { ms } from './budget.ts'
import { ensureAuthRefactorPanelOpen } from './panel-preference-helpers.ts'
import { revealSessionRow } from './session-rail-helpers.ts'

const STAMP = Date.now().toString(36)

const noHorizontalScroll = async (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)

test('phone (375×812): rail drawer over a scrim, full-viewport panel takeover, send works, no horizontal scroll', async ({ page }) => {
  test.setTimeout(ms(120_000))
  await page.setViewportSize({ width: 375, height: 812 })
  await ensureAuthRefactorPanelOpen(page)
  await page.context().setExtraHTTPHeaders({
    'x-user-id': 'user-ada',
    'x-tenant-id': `tenant-responsive-phone-${randomUUID()}`,
  })
  await page.goto('/')

  // The rail starts closed on narrow — the reopen control is the door, and it
  // sits IN the layout (a header row), not floating over content: scrolling
  // content must never slide underneath it. Floating would be position:absolute.
  const reopen = page.getByRole('button', { name: 'Expand sidebar' })
  await expect(reopen).toBeVisible()
  expect(
    await reopen.evaluate((el) => getComputedStyle(el).position),
    'narrow rail toggle is in-flow, not floating',
  ).toBe('static')
  expect(await noHorizontalScroll(page), 'no horizontal scroll on boot').toBe(true)

  // Closed, the drawer's buried controls must be OUT of the tab order and
  // accessibility tree (UI-8): its width-0 clip hides pixels, not semantics.
  await expect(page.locator('aside').locator('xpath=ancestor::*[@inert]')).toHaveCount(1)

  // Open the drawer: the rail floats over the app with a scrim beside it, and
  // the clamp leaves a tappable sliver (the rail can't cover the viewport).
  await reopen.click()
  const rail = page.locator('aside')
  await expect(rail).toBeVisible()
  // …and now the COVERED side is what's inert: the drawer floats over the
  // main region, so main leaves the tree while the drawer is up (UI-8).
  await expect(page.locator('main[inert]')).toHaveCount(1)
  const railBox = (await rail.boundingBox())!
  expect(railBox.x, 'drawer flush left').toBe(0)
  expect(railBox.width, 'drawer leaves a scrim sliver').toBeLessThanOrEqual(375 - 56)

  // Picking from the drawer navigates AND dismisses it (the drawer covers what
  // the pick opens — the reopen control coming back is the drawer being gone).
  // "New session" starts a fresh draft; the send below materializes it.
  await page.getByRole('navigation').getByRole('button', { name: 'New session' }).click()
  await expect(reopen).toBeVisible()
  await expect(page.locator('main[inert]')).toHaveCount(0)

  // The composer works at phone width; the turn round-trips.
  const message = `responsive phone hello ${STAMP}`
  await page.getByPlaceholder('Reply to Claude…').fill(message)
  await page.keyboard.press('Enter')
  await expect(page.getByText(/free-form chat is canned/).first()).toBeVisible({ timeout: ms(20_000) })
  expect(await noHorizontalScroll(page), 'no horizontal scroll with a thread').toBe(true)

  // A context panel on narrow is a TAKEOVER: the seeded repo session restores
  // its repo focus on open, so the panel appears on select.
  // The send owns its usage partition; the seeded panel belongs to Ada's demo
  // tenant. A full navigation disposes that first account's UI/cache before
  // returning to the separate panel fixture. The send never spends its quota.
  await page.context().setExtraHTTPHeaders({})
  await page.goto('/')
  await expect(reopen).toBeVisible()
  await reopen.click()
  await expect(page.locator('main[inert]')).toHaveCount(1)
  await page.getByRole('button', { name: 'Expand Sessions' }).click()
  // Disclosure only expands the tree; it must not dismiss the narrow drawer.
  await expect(page.locator('main[inert]')).toHaveCount(1)
  await (await revealSessionRow(page, 'Refactor auth middleware')).click()
  const panelClose = page.getByRole('button', { name: 'Close', exact: true }).first()
  await expect(panelClose).toBeVisible()
  // The PanelShell root (its border-l + bg-panel chrome) spans the viewport.
  const panelBox = (await page.locator('div.border-l.bg-panel').first().boundingBox())!
  expect(panelBox.width, 'panel takes the full viewport width').toBeGreaterThanOrEqual(370)
  // The takeover covers the thread — the covered thread is inert (UI-8).
  await expect(page.locator('main section[inert]')).toHaveCount(1)

  // Close returns to the thread (composer visible again).
  await panelClose.click()
  await expect(page.getByPlaceholder('Reply to Claude…')).toBeVisible()
  await expect(page.locator('main section[inert]')).toHaveCount(0)
  expect(await noHorizontalScroll(page), 'no horizontal scroll after panel close').toBe(true)
})

test('extreme narrow (320×700): every composer popover stays inside the viewport', async ({ page }) => {
  // The popover-containment invariant (docs/ui-invariants.md UI-1, src/lib/popover.ts)
  // at the width where the composer popovers used to truncate. Every surface the
  // shift hook manages stamps `data-popover` — the enumeration handle — so this
  // asserts the *class* generically instead of hand-measuring one popover.
  await page.setViewportSize({ width: 320, height: 700 })
  await page.goto('/')

  const MARGIN = 7 // POPOVER_MARGIN with a 1px rounding allowance
  const triggers = [
    'Add context',
    /^Permission mode/,
    'Model and effort',
    'Microphone settings',
    /^Usage/,
    /^Model providers/,
    /^Hosts/,
  ]
  for (const name of triggers) {
    await page.getByRole('button', { name }).first().click()
    const pop = page.locator('[data-popover]')
    await expect(pop, `${name} opens a managed popover`).toBeVisible()
    const box = (await pop.boundingBox())!
    expect(box.x, `${name} popover clears the left edge`).toBeGreaterThanOrEqual(MARGIN)
    expect(box.x + box.width, `${name} popover clears the right edge`).toBeLessThanOrEqual(320 - MARGIN)
    await page.keyboard.press('Escape')
    await expect(pop).not.toBeVisible()
  }

  // The @-mention completion list is the one overlay no TRIGGER opens — it is
  // armed by TYPING, so the loop above can never reach it, and it is portaled
  // rather than shift-hook-managed (a composer is not always in an unclipped
  // box), so it carries no `data-popover` either. It still owes UI-1, and this
  // is the width where a 256px list stops fitting beside an indented field.
  //
  // The seeded thread, not the square: this spec runs as the default tenant,
  // whose square roster is legitimately EMPTY (she follows nobody, and the feed
  // holds only her own acts, which the `mine` stamp drops) — so no list would
  // open and the measurement would be of nothing.
  //
  // What this proves and what it doesn't: the list opens on a 320px viewport
  // and lies inside it. It does NOT exercise the clamp — this composer's left
  // edge is small enough that the list would fit unclamped — so the clamp is
  // held where it can fail: `src/lib/popover.test.ts` (the `clampLeft` unit cases
  // at the boundaries, and the call-site scan that fails this file if the
  // shared math is dropped).
  await page.goto('/discussions/disc-seed-1')
  const reply = page.getByRole('textbox', { name: 'Reply to this discussion' })
  await expect(reply).toBeVisible({ timeout: ms(20_000) })
  await reply.click()
  await reply.pressSequentially('@')
  const list = page.getByRole('listbox', { name: 'Mention someone' })
  await expect(list, 'typing `@` arms the picker').toBeVisible({ timeout: ms(20_000) })
  const listBox = (await list.boundingBox())!
  expect(listBox.x, 'the mention list clears the left edge').toBeGreaterThanOrEqual(MARGIN)
  expect(listBox.x + listBox.width, 'the mention list clears the right edge').toBeLessThanOrEqual(320 - MARGIN)
  await page.keyboard.press('Escape')
  await expect(list).toHaveCount(0)

  // Row identity survives 320px (UI-7): the Routines rows' trailing controls
  // must not starve the flex-1 name column — the routine name renders at a
  // readable width, not zero (the invisible-but-space-reserving hover cluster
  // plus the status pill used to squeeze it out entirely).
  await page.getByRole('button', { name: 'Expand sidebar' }).click()
  await page.getByRole('navigation').getByRole('button', { name: /^Routines/ }).click()
  const name = page.locator('main').getByText('Triage new GitHub issues').first()
  await expect(name).toBeVisible()
  const nameBox = (await name.boundingBox())!
  expect(nameBox.width, 'routine name keeps readable width').toBeGreaterThan(60)
})

test('desktop (1280×800): the collapsed rail\'s reopen control is in-flow and never overlaps content (UI-3)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')

  // Collapse the rail: the reopen control appears in its own gutter COLUMN —
  // in the layout, not floating over it (UI-3, strengthened to every tier
  // after the equal-panes model killed the old pl-14 indent convention and
  // the floating button sat on every page title).
  await page.getByRole('button', { name: 'Collapse sidebar' }).click()
  // The rail collapses over a 200ms width transition — wait for the gutter to
  // settle at the left edge before measuring geometry (the clipped rail still
  // reads "visible" to Playwright, so poll the reopen control's position).
  const reopen = page.getByRole('button', { name: 'Expand sidebar' })
  await expect(reopen).toBeVisible()
  await expect.poll(async () => (await reopen.boundingBox())!.x).toBeLessThan(52)
  expect(
    await reopen.evaluate((el) => getComputedStyle(el).position),
    'wide-tier rail toggle is in-flow, not floating',
  ).toBe('static')

  // The control's box must not intersect the focused surface's title — the
  // draft conversation's title bar here, standing in for whatever pane is
  // top-left (all panes are homogeneous, so one geometry case locks the class).
  const reopenBox = (await reopen.boundingBox())!
  const title = page.locator('[data-session-title-bar]').getByText('New session').first()
  await expect(title).toBeVisible()
  const titleBox = (await title.boundingBox())!
  expect(
    titleBox.x,
    'pane content starts clear of the reopen gutter',
  ).toBeGreaterThanOrEqual(reopenBox.x + reopenBox.width)

  // A section page's h1 clears it too (the reported regression: "Projects"
  // rendered under the toggle).
  await reopen.click()
  await page.getByRole('navigation').getByRole('button', { name: /^Projects/ }).click()
  await page.getByRole('button', { name: 'Collapse sidebar' }).click()
  await expect.poll(async () => (await reopen.boundingBox())!.x).toBeLessThan(52)
  const h1 = page.locator('main h1').first()
  await expect(h1).toBeVisible()
  const h1Box = (await h1.boundingBox())!
  const reopenBox2 = (await reopen.boundingBox())!
  expect(
    h1Box.x,
    'page title starts clear of the reopen gutter',
  ).toBeGreaterThanOrEqual(reopenBox2.x + reopenBox2.width)

  // The mini-rail carries the focused-pane acts under the SAME gates as the
  // expanded rail (the shared PaneActionButtons): split the Projects page from
  // the collapsed rail, then close the duplicate back down.
  // Scope to the mini-rail's stamp: the clipped rail's copy is still in the
  // DOM (buried under its inert ancestor — UI-8 keeps it out of the tab
  // order, not out of the DOM).
  await page.locator('[data-mini-rail] [data-split-view="row"]').click()
  await expect(page.locator('main h1', { hasText: 'Projects' })).toHaveCount(2)
  await page.locator('[data-mini-rail] [data-close-view]').click()
  await expect(page.locator('main h1', { hasText: 'Projects' })).toHaveCount(1)

  // Each split direction gates on ITS OWN axis (canSplitRow: width;
  // canSplitCol: height): a wide-but-flat window keeps split-right and loses
  // split-down — and close stays, since one split is still offered.
  await page.setViewportSize({ width: 1280, height: 500 })
  await expect(page.locator('[data-mini-rail] [data-split-view="row"]')).toBeVisible()
  await expect(page.locator('[data-mini-rail] [data-split-view="col"]')).toHaveCount(0)
  await expect(page.locator('[data-mini-rail] [data-close-view]')).toBeVisible()
})

test('tablet (768×1024): the panel overlays the thread behind a scrim; the scrim click dismisses', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 })
  await ensureAuthRefactorPanelOpen(page)
  await page.goto('/')

  // The seeded repo session restores its repo focus on open — panel + scrim.
  await page.getByRole('button', { name: 'Expand Sessions' }).click()
  await (await revealSessionRow(page, 'Refactor auth middleware')).click()
  const panelClose = page.getByRole('button', { name: 'Close', exact: true }).first()
  await expect(panelClose).toBeVisible()
  const scrim = page.locator('div.bg-black\\/30')
  await expect(scrim).toBeVisible()

  // Overlay mode: the thread keeps its full width under the panel (the composer
  // still spans the thread column rather than being squeezed by the panel).
  const composerBox = (await page.getByPlaceholder('Reply to Claude…').boundingBox())!
  expect(composerBox.width).toBeGreaterThan(300)

  // The scrim (not the panel) dismisses on click — near its left edge, clear of
  // the panel that overlays the scrim's right side.
  await scrim.click({ position: { x: 15, y: 400 } })
  await expect(panelClose).not.toBeVisible()

  // Row metadata yields by CONTAINER width, not viewport width (UI-9): at a
  // 768px viewport the rail leaves the Routines rows ~450px — `md:`-gated
  // metadata used to show anyway, collapsing the name column to zero and
  // painting the pipeline glyphs over its neighbors. The name stays readable.
  await page.getByRole('navigation').getByRole('button', { name: /^Routines/ }).click()
  const routineName = page.locator('main').getByText(/Standup digest|Triage new/).first()
  await expect(routineName).toBeVisible()
  const routineBox = (await routineName.boundingBox())!
  expect(routineBox.width, 'routine name keeps readable width at tablet').toBeGreaterThan(60)
})

test('landscape phone (844×390, short): compressed chrome, usable composer', async ({ page }) => {
  await page.context().setExtraHTTPHeaders({
    'x-user-id': 'user-ada',
    'x-tenant-id': `tenant-responsive-landscape-${randomUUID()}`,
  })
  await page.setViewportSize({ width: 844, height: 390 })
  await page.goto('/')

  // The short variant sheds the composer's disclaimer line.
  await expect(page.getByText('the model is a local mock')).toBeHidden()

  // Popovers taller than a landscape phone clamp their height and scroll
  // instead of pinning top and running off the bottom (UI-1's height half —
  // the /ui-review sweep found the usage popover at 456px in a 390px viewport).
  await page.getByRole('button', { name: /^Usage/ }).click()
  const pop = page.locator('[data-popover]')
  await expect(pop).toBeVisible()
  const box = (await pop.boundingBox())!
  expect(box.y, 'popover clears the top edge').toBeGreaterThanOrEqual(7)
  expect(box.y + box.height, 'popover clears the bottom edge').toBeLessThanOrEqual(390 - 7)
  await page.keyboard.press('Escape')
  await expect(pop).not.toBeVisible()

  // Thread + composer are both on screen and a send works.
  const message = `responsive landscape hello ${STAMP}`
  const composer = page.getByPlaceholder('Reply to Claude…')
  await expect(composer).toBeInViewport()
  await page.getByRole('navigation').getByRole('button', { name: 'New session' }).click()
  await composer.fill(message)
  await page.keyboard.press('Enter')
  await expect(page.getByText(/free-form chat is canned/).first()).toBeVisible({ timeout: ms(20_000) })
  expect(await noHorizontalScroll(page)).toBe(true)
})
