/** Browser evidence for the shell's keyboard bypass and the primary
 * conversation semantics. Source locks cannot prove focus order, focus
 * transfer, or the computed accessible tree. */
import { test, expect } from '@playwright/test'

test('the first Tab reveals one bypass and moves focus past the resource rail', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/models')
  await expect(page.getByRole('heading', { level: 1, name: 'Models' })).toBeVisible()

  const skip = page.getByRole('button', { name: 'Skip to main content' })
  await expect(skip).toBeAttached()
  const resting = await skip.boundingBox()
  expect(resting, 'the bypass has rendered geometry').not.toBeNull()
  expect(resting!.y + resting!.height, 'it is outside the viewport at rest').toBeLessThanOrEqual(0)

  await page.keyboard.press('Tab')
  await expect(skip).toBeFocused()
  await expect.poll(
    async () => (await skip.boundingBox())?.y ?? -1,
    { message: 'keyboard focus reveals the bypass inside the viewport' },
  ).toBeGreaterThanOrEqual(0)

  await page.keyboard.press('Enter')
  const main = page.locator('main#main-workspace')
  await expect(main).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'New provider' })).toBeFocused()

  // On a phone the rail overlays—and inerts—the main surface. The same bypass
  // first dismisses that drawer, then transfers focus after React clears inert.
  await page.setViewportSize({ width: 375, height: 700 })
  await page.goto('/models')
  const narrowMain = page.locator('main#main-workspace')
  await page.getByRole('button', { name: 'Expand sidebar' }).click()
  await expect(narrowMain).toHaveAttribute('inert', '')
  await skip.focus()
  await skip.press('Enter')
  await expect(narrowMain).not.toHaveAttribute('inert', '')
  await expect(narrowMain).toBeFocused()
})

test('an established conversation has a navigable title and named message field', async ({ page }) => {
  await page.goto('/s/auth-refactor')
  const pane = page.locator('[data-conversation-pane="auth-refactor"]')

  await expect(pane.getByRole('heading', { level: 1, name: 'Refactor auth middleware' })).toBeVisible()
  await expect(pane.getByRole('textbox', { name: 'Message' })).toHaveAttribute('placeholder', 'Reply to Claude…')
})
