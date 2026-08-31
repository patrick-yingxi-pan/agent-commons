/** DESKTOP-O2 — rendered desktop backup controls. The packaged smoke proves
 * the real preload/main/utility path; this lane exercises the shared UI states
 * with the same narrow bridge and at the minimum supported viewport. */
import { test, expect } from '@playwright/test'

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
  await expect.poll(() => page.evaluate(() => (window as any).__desktopDataCalls)).toEqual([
    'createBackup',
    'revealBackups',
  ])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
    'backup controls create no horizontal page scroll').toBe(true)
})

test('the web Customize surface does not advertise device backup controls', async ({ page }) => {
  await page.goto('/customize')
  await expect(page.getByText('Local backups', { exact: true })).toHaveCount(0)
})
