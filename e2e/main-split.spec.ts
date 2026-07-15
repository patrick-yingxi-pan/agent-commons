/** The MAIN workspace split, focused-pane model (universal split, ADAPT-17):
 *  the rail's two split buttons (beside the bell) DUPLICATE the focused pane —
 *  no picker, no per-pane chrome; rail navigation retargets the focused pane;
 *  a hover-revealed floating ✕ closes a secondary pane; the URL never follows
 *  a secondary pane. The tree math is locked by tests/main-split.test.ts;
 *  this locks the wiring. */
import { test, expect } from '@playwright/test'

test('split duplicates the focused conversation; the rail retargets the focused pane; close dissolves', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 })
  await page.goto('/s/auth-refactor')
  await expect(page.getByText('token refresh logic').first()).toBeVisible()

  // The rail offers BOTH directions on the wide tier, next to the bell.
  await expect(page.locator('[data-split-view="col"]')).toBeVisible()
  await page.locator('[data-split-view="row"]').click()

  // The frame is up: pane a is the primary; pane b is a DUPLICATE of the same
  // conversation (no picker step), and it took focus.
  await expect(page.locator('[data-main-split]')).toBeVisible()
  await expect(page.locator('[data-main-pane]')).toHaveCount(2)
  const paneB = page.locator('[data-main-pane="b"]')
  await expect(paneB.locator('[data-conversation-pane="auth-refactor"]')).toBeVisible()
  await expect(paneB).toHaveAttribute('data-focused', 'true')

  // Rail navigation lands in the FOCUSED pane: clicking Projects retargets pane
  // b in place — the primary (and the address bar) never move.
  const before = page.url()
  await page.locator('nav[aria-label="Sections"]').getByText('Projects', { exact: true }).click()
  await expect(paneB.getByText('Platform hardening').first()).toBeVisible()
  expect(page.url()).toBe(before)
  await expect(page.locator('[data-main-pane="a"]').getByText('token refresh logic').first()).toBeVisible()

  // Pane-local navigation: a project detail opens INSIDE the pane; the URL stays.
  await paneB.getByText('Platform hardening').first().click()
  await expect(paneB.getByText('The platform team')).toBeVisible()
  expect(page.url()).toBe(before)

  // The main-pane divider is a named, keyboard-operable separator (UI-11).
  await expect(page.getByRole('separator', { name: 'Resize view panes (root)' })).toBeVisible()

  // No per-pane chrome: the only floating affordance is the hover-revealed ✕ on
  // the secondary pane; closing it dissolves the frame back to the plain surface.
  await paneB.hover()
  await paneB.locator('button[title="Close pane"]').click()
  await expect(page.locator('[data-main-split]')).toHaveCount(0)
  await expect(page.getByText('token refresh logic').first()).toBeVisible()
})

test('focus moves on pointer-down, and the split buttons act on the focused pane', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 })
  await page.goto('/s/auth-refactor')
  await expect(page.getByText('token refresh logic').first()).toBeVisible()

  // Split down: the duplicate below takes focus.
  await page.locator('[data-split-view="col"]').click()
  const paneB = page.locator('[data-main-pane="b"]')
  await expect(paneB).toHaveAttribute('data-focused', 'true')

  // Clicking back into the primary moves focus there…
  await page.locator('[data-main-pane="a"]').getByText('token refresh logic').first().click()
  await expect(page.locator('[data-main-pane="a"]')).toHaveAttribute('data-focused', 'true')

  // …so the next split acts on the PRIMARY pane: its slot subdivides (paths aa/ab)
  // while pane b stays put.
  await page.locator('[data-split-view="row"]').click()
  await expect(page.locator('[data-main-pane="aa"]')).toBeVisible()
  await expect(page.locator('[data-main-pane="ab"]')).toBeVisible()
  await expect(page.locator('[data-main-pane="b"]')).toBeVisible()
})

test('a duplicated conversation pane is fully independent: its own composer streams its own reply', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 })
  await page.goto('/s/auth-refactor')
  await expect(page.getByText('token refresh logic').first()).toBeVisible()

  // Split, then retarget the focused duplicate at a DIFFERENT seeded session
  // via the rail's Recents list.
  await page.locator('[data-split-view="row"]').click()
  await page.locator('aside').getByText('Dashboard query performance').first().click()
  const pane = page.locator('[data-conversation-pane="dashboard-perf"]')
  await expect(pane).toBeVisible()

  // Send FROM THE PANE — the reply streams into the pane's thread…
  const composer = pane.locator('[data-pane-composer]')
  await composer.fill('quick pane check')
  await composer.press('Enter')
  await expect(pane.getByText('quick pane check')).toBeVisible()
  await expect(pane.getByText(/local mock|workspace/).last()).toBeVisible({ timeout: 15_000 })

  // …while the PRIMARY (auth-refactor) is untouched and the URL never moved.
  await expect(page.locator('[data-main-pane="a"]').getByText('quick pane check')).toHaveCount(0)
  expect(new URL(page.url()).pathname).toBe('/s/auth-refactor')
})
