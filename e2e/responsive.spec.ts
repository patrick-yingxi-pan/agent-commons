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

const STAMP = Date.now().toString(36)

async function dismissIntro(page: Page, timeout = 2_500) {
  await page.getByRole('button', { name: 'Explore on my own' }).click({ timeout }).catch(() => {})
}

const noHorizontalScroll = async (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)

test('phone (375×812): rail drawer over a scrim, full-viewport panel takeover, send works, no horizontal scroll', async ({ page }) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/')
  await dismissIntro(page)

  // The rail starts closed on narrow — the floating reopen control is the door.
  const reopen = page.getByRole('button', { name: 'Expand sidebar' })
  await expect(reopen).toBeVisible()
  expect(await noHorizontalScroll(page), 'no horizontal scroll on boot').toBe(true)

  // Open the drawer: the rail floats over the app with a scrim beside it, and
  // the clamp leaves a tappable sliver (the rail can't cover the viewport).
  await reopen.click()
  const rail = page.locator('aside')
  await expect(rail).toBeVisible()
  const railBox = (await rail.boundingBox())!
  expect(railBox.x, 'drawer flush left').toBe(0)
  expect(railBox.width, 'drawer leaves a scrim sliver').toBeLessThanOrEqual(375 - 56)

  // Picking from the drawer navigates AND dismisses it (the drawer covers what
  // the pick opens — the reopen control coming back is the drawer being gone).
  // "New session" also dodges the demo-thread gotcha: the app opens on the demo
  // session, and a send there would land in its thread.
  await page.getByRole('navigation').getByRole('button', { name: 'New session' }).click()
  await expect(reopen).toBeVisible()

  // The composer works at phone width; the turn round-trips.
  const message = `responsive phone hello ${STAMP}`
  await page.getByPlaceholder('Reply to Claude…').fill(message)
  await page.keyboard.press('Enter')
  await expect(page.getByText(/static prototype/).first()).toBeVisible({ timeout: 20_000 })
  expect(await noHorizontalScroll(page), 'no horizontal scroll with a thread').toBe(true)

  // A context panel on narrow is a TAKEOVER: the seeded repo session restores
  // its repo focus on open, so the panel appears without running the tour.
  await reopen.click()
  await page.locator('aside').getByText('Refactor auth middleware').first().click()
  const panelClose = page.getByRole('button', { name: 'Close', exact: true }).first()
  await expect(panelClose).toBeVisible()
  // The PanelShell root (its border-l + bg-panel chrome) spans the viewport.
  const panelBox = (await page.locator('div.border-l.bg-panel').first().boundingBox())!
  expect(panelBox.width, 'panel takes the full viewport width').toBeGreaterThanOrEqual(370)

  // Close returns to the thread (composer visible again).
  await panelClose.click()
  await expect(page.getByPlaceholder('Reply to Claude…')).toBeVisible()
  expect(await noHorizontalScroll(page), 'no horizontal scroll after panel close').toBe(true)
})

test('tablet (768×1024): the panel overlays the thread behind a scrim; the scrim click dismisses', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 })
  await page.goto('/')
  await dismissIntro(page)

  // The seeded repo session restores its repo focus on open — panel + scrim.
  await page.locator('aside').getByText('Refactor auth middleware').first().click()
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
})

test('landscape phone (844×390, short): compressed chrome, usable composer', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 })
  await page.goto('/')
  await dismissIntro(page)

  // The short variant sheds the composer's disclaimer line.
  await expect(page.getByText('the model is a local mock')).toBeHidden()

  // Thread + composer are both on screen and a send works.
  const message = `responsive landscape hello ${STAMP}`
  const composer = page.getByPlaceholder('Reply to Claude…')
  await expect(composer).toBeInViewport()
  await page.getByRole('navigation').getByRole('button', { name: 'New session' }).click()
  await composer.fill(message)
  await page.keyboard.press('Enter')
  await expect(page.getByText(/static prototype/).first()).toBeVisible({ timeout: 20_000 })
  expect(await noHorizontalScroll(page)).toBe(true)
})
