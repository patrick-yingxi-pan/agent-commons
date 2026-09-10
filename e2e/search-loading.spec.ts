import { test, expect, type Page } from '@playwright/test'
import { ms } from './budget.ts'

const VIEWPORTS = [
  { width: 320, height: 700 },
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 844, height: 390 },
  { width: 1280, height: 800 },
]

async function expectContained(page: Page) {
  await expect.poll(() => page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>('[data-bounded-dialog]')?.getBoundingClientRect()
    const workspace = document.querySelector<HTMLElement>('[data-popover-viewport]')?.getBoundingClientRect()
    if (!panel) return false
    return panel.top >= (workspace?.top ?? 0) + 7
      && panel.bottom <= (workspace?.bottom ?? window.innerHeight) - 7
      && panel.left >= 7 && panel.right <= window.innerWidth - 7
  })).toBe(true)
}

async function openWorkspace(page: Page) {
  await page.goto('/')
  await expect(page.getByRole('complementary').getByRole('button', { name: 'Search', exact: true })).toBeVisible()
}

test('search loading boundary is announced and remains closable', async ({ page }) => {
  test.setTimeout(ms(30_000))
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  await page.route('**/src/components/SearchPanel.tsx*', async (route) => {
    await gate
    await route.continue()
  })
  await openWorkspace(page)
  await page.getByRole('complementary').getByRole('button', { name: 'Search', exact: true }).click()
  await expect(page.locator('[data-search-loading]')).toHaveAttribute('role', 'status')
  await expect(page.getByRole('button', { name: 'Close', exact: true })).toBeFocused()
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await expect(page.locator('[data-search-loading]')).toBeVisible()
    await expectContained(page)
    await page.screenshot({ path: `.data/search-loading-review/loading-${viewport.width}x${viewport.height}.png`, fullPage: false })
  }
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Close', exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Search' })).toBeHidden()
  release()
})

test('search chunk failure is contained with reload and close actions', async ({ page }) => {
  test.setTimeout(ms(30_000))
  let blocked = true
  await page.route('**/src/components/SearchPanel.tsx*', async (route) => blocked ? route.abort() : route.continue())
  await openWorkspace(page)
  await page.getByRole('complementary').getByRole('button', { name: 'Search', exact: true }).click()
  await expect(page.locator('[data-search-load-error]')).toHaveAttribute('role', 'alert')
  await expect(page.getByRole('button', { name: 'Reload', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Close', exact: true })).toBeFocused()
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await expectContained(page)
    await page.screenshot({ path: `.data/search-loading-review/error-${viewport.width}x${viewport.height}.png`, fullPage: false })
  }
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Reload', exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Search' })).toBeHidden()
  await page.setViewportSize({ width: 1280, height: 800 })
  const expand = page.getByRole('button', { name: 'Expand sidebar', exact: true })
  if (await expand.isVisible()) await expand.click()
  await page.getByRole('complementary').getByRole('button', { name: 'Search', exact: true }).click()
  await expect(page.locator('[data-search-load-error]')).toBeVisible()
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Search' })).toBeHidden()
  await page.getByRole('complementary').getByRole('button', { name: 'Search', exact: true }).click()
  await expect(page.locator('[data-search-load-error]')).toBeVisible()
  blocked = false
  await page.getByRole('button', { name: 'Reload', exact: true }).click()
  await expect(page.getByRole('complementary').getByRole('button', { name: 'Search', exact: true })).toBeVisible()
  await page.getByRole('complementary').getByRole('button', { name: 'Search', exact: true }).click()
  await expect(page.getByRole('textbox', { name: /Search everything/ })).toBeVisible()
  await page.getByRole('textbox', { name: /Search everything/ }).fill('real query')
})
