/** SYNC-10: a broken ambient stream must not leave the workspace silently
 * looking live. Recovery clears the notice only after the next real hello. */
import { test, expect } from '@playwright/test'
import { ms } from './budget.ts'

test('ambient-stream failure is disclosed globally and clears on recovery', async ({ page }) => {
  test.setTimeout(ms(45_000))
  let blocked = true
  await page.route('**/api/v1/events', async (route) => {
    if (blocked) await route.abort('connectionrefused')
    else await route.continue()
  })

  await page.goto('/')
  const notice = page.getByRole('status').filter({ hasText: 'Live updates paused. Reconnecting…' })
  await expect(notice).toBeVisible({ timeout: ms(12_000) })

  // One in-flow strip remains legible without stealing a meaningful share of
  // the workspace at desktop, phone, or short-landscape geometry.
  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 375, height: 812 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport)
    const box = await notice.boundingBox()
    expect(box, `${viewport.width}×${viewport.height}: notice is painted`).toBeTruthy()
    expect(box!.x, `${viewport.width}×${viewport.height}: flush left`).toBe(0)
    expect(box!.width, `${viewport.width}×${viewport.height}: spans the shell`).toBe(viewport.width)
    expect(box!.height, `${viewport.width}×${viewport.height}: compact`).toBeLessThanOrEqual(32)
    await expect(page.locator('main')).toBeVisible()
  }

  blocked = false
  await expect(notice).toHaveCount(0, { timeout: ms(15_000) })
})
