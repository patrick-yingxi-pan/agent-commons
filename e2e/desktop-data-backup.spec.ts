/** DESKTOP-O2 — rendered desktop backup controls. The packaged smoke proves
 * the real preload/main/utility path; this lane exercises the shared UI states
 * with the same narrow bridge and at the minimum supported viewport. */
import { test, expect } from '@playwright/test'
import { assertWcag22Aa } from './accessibility-helpers.ts'

const REVIEW_VIEWPORTS = [
  { width: 320, height: 700 },
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 844, height: 390 },
  { width: 1280, height: 800 },
]

test('desktop Customize creates and reveals portable backups without filesystem authority', async ({ page }) => {
  await page.addInitScript(() => {
    ;(window as any).__desktopDataCalls = []
    Object.defineProperty(window, 'agentCommonsDesktop', {
      configurable: false,
      value: {
        data: {
          createBackup: async () => {
            ;(window as any).__desktopDataCalls.push('createBackup')
            return {
              fileName: 'backup-2026-08-31T18-25-43-210Z-a1b2c3d4e5f60718.json',
              sizeBytes: 4096,
              createdAt: '2026-08-31T18:25:43.210Z',
            }
          },
          revealBackups: async () => { ;(window as any).__desktopDataCalls.push('revealBackups') },
          restoreBackup: async () => {
            ;(window as any).__desktopDataCalls.push('restoreBackup')
            return { status: 'cancelled' }
          },
        },
      },
    })
  })
  await page.setViewportSize({ width: 320, height: 700 })
  await page.goto('/customize')

  await expect(page.getByText('Local backups', { exact: true })).toBeVisible()
  await expect(page.getByText('Seven daily recovery copies are kept automatically', { exact: false })).toBeVisible()
  await expect(page.getByText('no provider API keys', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: 'Back up now' }).click()
  await expect(page.getByRole('status')).toContainText('Saved backup-2026-08-31')
  await page.getByRole('button', { name: 'Show backups' }).click()
  await page.getByRole('button', { name: 'Restore backup…' }).click()
  await expect.poll(() => page.evaluate(() => (window as any).__desktopDataCalls)).toEqual([
    'createBackup',
    'revealBackups',
    'restoreBackup',
  ])
  await expect(page.getByRole('status')).toContainText('Saved backup-2026-08-31')

  for (const viewport of REVIEW_VIEWPORTS) {
    await page.setViewportSize(viewport)
    for (const name of ['Show backups', 'Restore backup…', 'Back up now']) {
      await expect(page.getByRole('button', { name })).toBeVisible()
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
      `backup controls create no horizontal page scroll at ${viewport.width}×${viewport.height}`).toBe(true)
  }

  await page.setViewportSize({ width: 375, height: 812 })
  await assertWcag22Aa(page, 'native Local backups card')
})

test('the web Customize surface does not advertise device backup controls', async ({ page }) => {
  await page.goto('/customize')
  await expect(page.getByText('Local backups', { exact: true })).toHaveCount(0)
})
