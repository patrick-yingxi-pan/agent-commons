/** Seeded workspace artifacts must render their authored body through the real
 * ArtifactPanel, not the name-keyed synopsis/scaffold projection. */
import { test, expect } from '@playwright/test'
import { ms } from './budget.ts'

const VIEWPORTS = [
  { width: 320, height: 700 },
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 844, height: 390 },
  { width: 1280, height: 800 },
]

test('Noor’s seeded homepage workspace document shows its authored body in ArtifactPanel', async ({ page }, testInfo) => {
  test.setTimeout(ms(60_000))
  await page.context().setExtraHTTPHeaders({
    'x-user-id': 'user-noor',
    'x-tenant-id': 'tenant-northlight',
  })

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await page.goto('/s/homepage-rewrite')
    await expect(page.getByRole('button', { name: 'homepage-rewrite/', exact: true })).toBeVisible()

    // The seeded workspace is restored as the session's initial context pane.
    // Phones/tablets use an overlay dock tier; wide layouts use a context pane.
    // Await the actual restored surface rather than toggling its chip.
    const panel = page.locator('[data-overlay-dock], [data-context-pane]').first()
    await expect(panel).toBeVisible()
    await expect(panel.getByRole('button', { name: /^homepage-copy\.md/ })).toBeVisible()
    await panel.getByRole('button', { name: /^homepage-copy\.md/ }).click()
    await expect(panel.getByText('Hero', { exact: true })).toBeVisible()
    await expect(panel.getByText(/See what your product is actually doing/)).toBeVisible()
    await expect(panel.locator('[data-folder-snapshot-preview]')).toHaveCount(0)
    await expect(panel.getByText('New hero, three proof points, one CTA.', { exact: true })).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath(`workspace-body-${viewport.width}x${viewport.height}.png`), fullPage: true })
  }
})
