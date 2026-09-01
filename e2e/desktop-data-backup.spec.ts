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
          getRecoveryStatus: async () => {
            ;(window as any).__desktopDataCalls.push('getRecoveryStatus')
            return {
              status: 'ready',
              backup: {
                fileName: 'recovery-2026-08-31.json',
                sizeBytes: 4096,
                createdAt: '2026-08-31T18:25:43.210Z',
              },
            }
          },
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
  await expect(page.getByText('newest seven automatic daily recovery copies', { exact: false })).toBeVisible()
  await expect(page.getByText('Today’s automatic recovery copy is ready', { exact: false })).toBeVisible()
  await expect(page.getByText('no provider API keys', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: 'Back up now' }).click()
  await expect(page.getByText('Saved backup-2026-08-31', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: 'Show backups' }).click()
  await page.getByRole('button', { name: 'Restore backup…' }).click()
  await expect.poll(() => page.evaluate(() =>
    (window as any).__desktopDataCalls.filter((call: string) => call !== 'getRecoveryStatus'),
  )).toEqual(['createBackup', 'revealBackups', 'restoreBackup'])
  expect(await page.evaluate(() =>
    (window as any).__desktopDataCalls.filter((call: string) => call === 'getRecoveryStatus').length,
  )).toBeGreaterThanOrEqual(1)
  await expect(page.getByText('Saved backup-2026-08-31', { exact: false })).toBeVisible()

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

test('desktop Customize discloses automatic recovery failure and keeps manual recovery actionable', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'agentCommonsDesktop', {
      configurable: false,
      value: {
        data: {
          getRecoveryStatus: async () => ({ status: 'failed' }),
          createBackup: async () => ({
            fileName: 'backup-2026-08-31T18-25-43-210Z-a1b2c3d4e5f60718.json',
            sizeBytes: 4096,
            createdAt: '2026-08-31T18:25:43.210Z',
          }),
          revealBackups: async () => undefined,
          restoreBackup: async () => ({ status: 'cancelled' }),
        },
      },
    })
  })
  await page.setViewportSize({ width: 320, height: 700 })
  await page.goto('/customize')

  await expect(page.getByRole('alert')).toContainText('automatic recovery copy couldn’t be confirmed')
  await expect(page.getByRole('alert')).toContainText('Back up now to protect current work')
  await page.getByRole('button', { name: 'Back up now' }).click()
  await expect(page.getByText('Saved backup-2026-08-31', { exact: false })).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('retry automatically next launch')
  await assertWcag22Aa(page, 'failed automatic recovery state')
})

test('the web Customize surface does not advertise device backup controls', async ({ page }) => {
  await page.goto('/customize')
  await expect(page.getByText('Local backups', { exact: true })).toHaveCount(0)
})
