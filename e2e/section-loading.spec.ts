/** PD67: section hubs are an on-demand production chunk. The source/build locks
 * prove the graph; this proves the user sees a page-shaped, announced state and
 * keeps the shell while a real module request is still pending. */
import { test, expect } from '@playwright/test'
import { ms } from './budget.ts'

test('a delayed section chunk keeps the shell usable and resolves in place', async ({ page }) => {
  test.setTimeout(ms(40_000))
  await page.setViewportSize({ width: 1280, height: 800 })

  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let intercepted = false
  await page.route('**/src/components/SectionPane.tsx*', async (route) => {
    intercepted = true
    await gate
    await route.continue()
  })

  const navigation = page.goto('/projects')
  try {
    const loading = page.locator('[data-section-loading]')
    await expect(loading).toBeVisible({ timeout: ms(20_000) })
    await expect(loading).toHaveAttribute('role', 'status')
    await expect(loading).toContainText('Loading Projects…')
    await expect(page.locator('nav[aria-label="Sections"]').getByRole('button', { name: 'Projects', exact: true })).toBeVisible()
    expect(intercepted, 'the test held the real dynamic module request').toBe(true)
  } finally {
    release()
  }

  await navigation
  await expect(page.locator('[data-section-loading]')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible({ timeout: ms(20_000) })
})

test('a failed section chunk keeps the shell usable and offers recovery', async ({ page }) => {
  test.setTimeout(ms(40_000))
  await page.setViewportSize({ width: 1280, height: 800 })

  let intercepted = false
  await page.route('**/src/components/SectionPane.tsx*', async (route) => {
    intercepted = true
    await route.abort('failed')
  })

  await page.goto('/projects')
  const failed = page.locator('[data-section-load-error]')
  await expect(failed).toBeVisible({ timeout: ms(20_000) })
  await expect(failed).toHaveAttribute('role', 'alert')
  await expect(failed).toContainText('Couldn’t load Projects')
  await expect(failed.getByRole('button', { name: 'Try again' })).toBeVisible()
  await expect(page.locator('nav[aria-label="Sections"]').getByRole('button', { name: 'Projects', exact: true })).toBeVisible()
  expect(intercepted, 'the test failed the real dynamic module request').toBe(true)
})
