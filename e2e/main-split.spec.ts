/** The MAIN workspace split (universal split Phase 2): the rail's "Split the
 *  view" button tiles the main surface — the primary pane (thread/section)
 *  beside an independent section pane with PANE-LOCAL navigation (the URL never
 *  follows a pane's detail); closing back to one pane dissolves the frame.
 *  The tree math is locked by tests/main-split.test.ts; this locks the wiring. */
import { test, expect } from '@playwright/test'

test('split the view → pick Projects → pane-local detail; the URL stays the primary’s; close dissolves', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 })
  await page.goto('/')

  // The rail offers the split on the wide tier.
  const splitBtn = page.locator('[data-split-view]')
  await expect(splitBtn).toBeVisible()
  await splitBtn.click()

  // The frame is up: the primary keeps pane a; pane b is the picker.
  await expect(page.locator('[data-main-split]')).toBeVisible()
  await expect(page.locator('[data-main-pane]')).toHaveCount(2)
  await page.locator('[data-main-picker] button', { hasText: 'Projects' }).click()

  // Pane b is a LIVE Projects page; the primary (the draft composer) is intact.
  const paneB = page.locator('[data-main-pane="b"]')
  await expect(paneB.getByText('Platform hardening').first()).toBeVisible()
  await expect(page.locator('[data-main-pane="a"] textarea')).toBeVisible()

  // Pane-local navigation: a project detail opens INSIDE the pane; the address
  // bar never moves (it names the primary surface — ADAPT-15 unchanged).
  const before = page.url()
  await paneB.getByText('Platform hardening').first().click()
  await expect(paneB.getByText('The platform team')).toBeVisible()
  expect(page.url()).toBe(before)

  // The main-pane divider is a named, keyboard-operable separator (UI-11).
  await expect(page.getByRole('separator', { name: 'Resize view panes (root)' })).toBeVisible()

  // Closing the section pane dissolves the frame back to the plain surface.
  await paneB.locator('button[title="Close pane"]').click()
  await expect(page.locator('[data-main-split]')).toHaveCount(0)
  await expect(page.locator('textarea')).toBeVisible()
})

test('a conversation pane is fully independent: its own composer streams its own reply (Phase 3)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 })
  await page.goto('/')

  await page.locator('[data-split-view]').click()
  // Pick a seeded conversation into the new pane.
  await page.locator('[data-pick-session="auth-refactor"]').click()
  const pane = page.locator('[data-conversation-pane="auth-refactor"]')
  await expect(pane.getByText('token refresh logic').first()).toBeVisible()

  // Send FROM THE PANE — the reply streams into the pane's thread…
  const composer = pane.locator('[data-pane-composer]')
  await composer.fill('quick pane check')
  await composer.press('Enter')
  await expect(pane.getByText('quick pane check')).toBeVisible()
  await expect(pane.getByText(/local mock|workspace/).last()).toBeVisible({ timeout: 15_000 })

  // …while the PRIMARY (the fresh draft) is untouched and the URL never moved.
  // (The e2e stack runs an isolated store, so the persisted turn is run-local.)
  await expect(page.locator('[data-main-pane="a"]').getByText('quick pane check')).toHaveCount(0)
  expect(new URL(page.url()).pathname).toBe('/')
})
