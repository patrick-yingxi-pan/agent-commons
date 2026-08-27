/** Cross-device FWD-2 wiring: panel intent is server-owned per viewer, with
 * isolated browser storage. Store/route suites lock the tri-state and races;
 * this proves the rendered app writes, pushes, and reconciles it. */
import { test, expect } from '@playwright/test'
import { ensureAuthRefactorPanelOpen } from './panel-preference-helpers.ts'

const preferencePatch = (url: string) => url.includes('/sessions/auth-refactor/preferences')

test('closing and reopening a context panel synchronizes across browser devices', async ({ page, browser }) => {
  await page.setViewportSize({ width: 1280, height: 1000 })
  await ensureAuthRefactorPanelOpen(page)
  await page.goto('/s/auth-refactor')
  await expect(page.getByText('token refresh logic').first()).toBeVisible()
  await expect(page.locator('[data-context-pane]')).toBeVisible()

  const closeAck = page.waitForResponse((response) =>
    response.request().method() === 'PATCH' && preferencePatch(response.url()) && response.ok(),
  )
  await page.locator('[data-context-pane]').dispatchEvent('pointerdown')
  await page.locator('[data-close-view]').click()
  await expect(page.locator('[data-context-pane]')).toHaveCount(0)
  await closeAck

  // A second isolated BrowserContext has no localStorage from the first one.
  // Its closed state can therefore come only from the server projection.
  const otherContext = await browser.newContext()
  const other = await otherContext.newPage()
  await other.setViewportSize({ width: 1280, height: 1000 })
  await other.goto('/s/auth-refactor')
  await expect(other.getByText('token refresh logic').first()).toBeVisible()
  await expect(other.locator('[data-context-pane]')).toHaveCount(0)

  // Reopen from device one. The ordinary session.updated push makes the
  // already-open device two refetch its viewer preference and tile the panel.
  const openAck = page.waitForResponse((response) =>
    response.request().method() === 'PATCH' && preferencePatch(response.url()) && response.ok(),
  )
  await page.getByRole('button', { name: 'patrick-yingxi-pan/server', exact: true }).click()
  await expect(page.locator('[data-context-pane]')).toBeVisible()
  await openAck
  await expect(other.locator('[data-context-pane]')).toBeVisible()
  await expect(other.locator('[data-context-pane]')).toHaveAttribute('data-context-pane', /^auth-refactor repo/)

  await otherContext.close()
})
