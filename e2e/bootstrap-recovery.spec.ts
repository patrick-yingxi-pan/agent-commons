/** ADAPT-26: slow or failed bootstrap reads must never look like an empty app,
 * and one retry must reissue the complete decision barrier in place. */
import { test, expect, type Route } from '@playwright/test'
import { ms } from './budget.ts'

test('application bootstrap shows progress, explains failure, and recovers without a reload', async ({ page }) => {
  test.setTimeout(ms(45_000))
  let phase: 'hold' | 'fail' | 'pass' = 'hold'
  let releaseHeld!: () => void
  const held = new Promise<void>((resolve) => {
    releaseHeld = resolve
  })
  const gate = async (route: Route) => {
    if (phase === 'hold') await held
    if (phase === 'fail') await route.abort('connectionrefused')
    else await route.continue()
  }
  await page.route('**/api/v1/capabilities', gate)
  await page.route('**/api/v1/me', gate)

  await page.goto('/')
  const bootstrap = page.getByTestId('app-bootstrap')
  await expect(bootstrap).toHaveAttribute('data-bootstrap-state', 'loading')
  await expect(bootstrap.getByRole('status')).toContainText('Loading your account…')

  phase = 'fail'
  releaseHeld()
  await expect(bootstrap).toHaveAttribute('data-bootstrap-state', 'error')
  await expect(bootstrap.getByRole('alert')).toContainText('Couldn’t open Agent Commons')
  await expect(page.getByTestId('account-chip')).toHaveCount(0)

  // The pre-app surface remains a complete, compact viewport at the same three
  // geometries as the responsive ladder — no blank short-landscape edge.
  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 375, height: 812 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport)
    const box = await bootstrap.boundingBox()
    expect(box, `${viewport.width}×${viewport.height}: bootstrap is painted`).toBeTruthy()
    expect(box!.x, `${viewport.width}×${viewport.height}: flush left`).toBe(0)
    expect(box!.y, `${viewport.width}×${viewport.height}: flush top`).toBe(0)
    expect(box!.width, `${viewport.width}×${viewport.height}: full width`).toBe(viewport.width)
    expect(box!.height, `${viewport.width}×${viewport.height}: full height`).toBeGreaterThanOrEqual(viewport.height)
    await expect(bootstrap.getByRole('button', { name: 'Try again' })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width)
  }

  phase = 'pass'
  await bootstrap.getByRole('button', { name: 'Try again' }).click()
  await expect(bootstrap).toHaveCount(0, { timeout: ms(10_000) })
  await expect(page.getByTestId('account-chip')).toContainText('Ada Lovelace')
})
