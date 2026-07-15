/** The MAIN workspace split, focused-pane model (universal split, ADAPT-17):
 *  the rail's split/close cluster (beside the bell) acts on the FOCUSED pane —
 *  the split buttons DUPLICATE it (no picker, no per-pane chrome), and close
 *  is HOMOGENEOUS: a secondary pane collapses, while closing the primary tile
 *  relocates the primary role into the surviving pane (its content promotes
 *  into the controller, so the URL follows what remains); rail navigation
 *  retargets the focused pane; the URL never follows a secondary pane. The tree math is locked by tests/main-split.test.ts;
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

  // No per-pane chrome at all: close lives in the rail cluster and acts on the
  // FOCUSED pane — homogeneously. Focus pane b (secondary) and close: it
  // collapses, the frame dissolves, the primary conversation survives.
  // (dispatchEvent: focus rides pointer-down capture, and actionability would
  // wait forever on the thread's continuous animations.)
  await paneB.dispatchEvent('pointerdown')
  await page.locator('[data-close-view]').click()
  await expect(page.locator('[data-main-split]')).toHaveCount(0)
  await expect(page.getByText('token refresh logic').first()).toBeVisible()
})

test('closing the focused PRIMARY tile is homogeneous: the survivor promotes and the URL follows', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 })
  await page.goto('/s/auth-refactor')
  await expect(page.getByText('token refresh logic').first()).toBeVisible()

  // Split (duplicate takes focus), retarget the duplicate at Projects.
  await page.locator('[data-split-view="row"]').click()
  await page.locator('nav[aria-label="Sections"]').getByText('Projects', { exact: true }).click()
  const paneB = page.locator('[data-main-pane="b"]')
  await expect(paneB.getByText('Platform hardening').first()).toBeVisible()

  // Focus the PRIMARY tile and close it: the close button is offered (panes
  // are equals), the Projects pane's content promotes into the controller —
  // the frame dissolves onto Projects and the ADDRESS follows what survived.
  await page.locator('[data-main-pane="a"]').dispatchEvent('pointerdown')
  await expect(page.locator('[data-close-view]')).toBeVisible()
  await page.locator('[data-close-view]').click()
  await expect(page.locator('[data-main-split]')).toHaveCount(0)
  await expect(page.getByText('Platform hardening').first()).toBeVisible()
  await expect(page).toHaveURL(/\/projects$/)
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
