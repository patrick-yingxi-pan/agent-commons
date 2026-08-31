/** PORT-13 / CTX-FS-4 — the Electron picker is a narrow renderer capability,
 * while the rest of Add context stays the shared browser workflow. Main-side
 * tests lock real dialog/fs mediation; this lane locks recovery and attachment. */
import { test, expect } from '@playwright/test'

test('desktop file and folder picks attach through the shared context workflow and recover in place', async ({ page }) => {
  await page.addInitScript(() => {
    let fileAttempt = 0
    ;(window as any).__desktopContextCalls = []
    Object.defineProperty(window, 'agentCommonsDesktop', {
      configurable: false,
      value: {
        context: {
          pickFiles: async (accept: 'image' | 'any') => {
            ;(window as any).__desktopContextCalls.push(['pickFiles', accept])
            fileAttempt += 1
            if (fileAttempt === 1) return { status: 'rejected', reason: 'too-many-files' }
            return {
              status: 'selected',
              files: [{ name: 'release-notes.md', kind: 'file', sizeBytes: 18, text: 'Native file body.' }],
            }
          },
          pickFolder: async () => {
            ;(window as any).__desktopContextCalls.push(['pickFolder'])
            return {
              status: 'selected',
              folder: {
                name: 'research',
                files: [
                  { name: 'summary.md', sizeBytes: 12 },
                  { name: 'chart.png', sizeBytes: 4096 },
                ],
              },
            }
          },
        },
      },
    })
  })
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/')
  const dock = page.locator('[data-overlay-dock="narrow"]')

  await page.getByRole('button', { name: 'Add context' }).click()
  let picker = page.getByRole('dialog', { name: 'Add context' })
  await picker.getByRole('button', { name: /^Files/ }).click()
  await picker.getByRole('button', { name: 'This computer' }).click()
  const chooseFiles = picker.getByRole('button', { name: /Add files from this computer/ })
  await chooseFiles.click()
  await expect(picker.getByRole('alert')).toHaveText('Choose no more than 24 files at a time.')
  await chooseFiles.click()
  await expect(page.getByText('Native file body.', { exact: true })).toBeVisible()
  await dock.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.getByText('Native file body.', { exact: true })).toHaveCount(0)
  await expect(picker).toHaveCount(0)
  await expect(page.getByTitle('Open in sidebar').filter({ hasText: 'release-notes.md' })).toBeVisible()

  await page.getByRole('button', { name: 'Add context' }).click()
  picker = page.getByRole('dialog', { name: 'Add context' })
  await picker.getByRole('button', { name: /^Folder/ }).click()
  await picker.getByRole('button', { name: 'This computer' }).click()
  await picker.getByRole('button', { name: /Choose a folder from this computer/ }).click()
  await expect(dock.getByTitle('Workspace', { exact: true })).toBeVisible()
  await expect(dock.getByRole('button', { name: 'Close', exact: true })).toHaveCount(1)
  await dock.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(picker).toHaveCount(0)
  await expect(page.getByTitle('Open in sidebar').filter({ hasText: 'research/' })).toBeVisible()

  await expect.poll(() => page.evaluate(() => (window as any).__desktopContextCalls)).toEqual([
    ['pickFiles', 'any'],
    ['pickFiles', 'any'],
    ['pickFolder'],
  ])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
    'native picker recovery creates no horizontal page scroll').toBe(true)
})
