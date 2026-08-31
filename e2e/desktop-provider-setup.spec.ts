/** PORT-12 / MODEL-28 — the native credential face is a renderer capability,
 * not a second provider workflow. Package smoke proves the real preload/main/
 * utility path; this browser lane injects that exact narrow face so the shared
 * dialog can be exhaustively measured at every canonical viewport. */
import { test, expect } from '@playwright/test'
import { ms } from './budget.ts'

const VIEWPORTS = [
  { width: 320, height: 700 },
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 844, height: 390 },
  { width: 1280, height: 800 },
]

test('desktop provider setup keeps its OS-encrypted key face reachable at every viewport', async ({ page }) => {
  test.setTimeout(ms(90_000))
  await page.addInitScript(() => {
    Object.defineProperty(window, 'agentCommonsDesktop', {
      configurable: false,
      value: {
        credentials: {
          provision: async () => `PROVIDER_DESKTOP_${'A'.repeat(32)}`,
          bind: async () => undefined,
          discard: async () => undefined,
          removeProvider: async () => undefined,
        },
      },
    })
  })
  await page.goto('/models')
  const login = await page.request.post('/api/v1/auth/login', {
    data: { email: 'ada@acme.example', password: 'ada-demo-password' },
  })
  expect(login.ok()).toBeTruthy()
  await page.reload()
  await page.getByRole('button', { name: 'New provider', exact: true }).click()

  const dialog = page.getByRole('dialog', { name: 'New provider' })
  const panel = dialog.locator(':scope > div').nth(1)
  const body = panel.locator(':scope > div').nth(1)
  const footer = panel.locator(':scope > div').nth(2)
  const key = page.getByPlaceholder('Paste API key', { exact: true })
  await expect(key).toHaveAttribute('type', 'password')
  await expect(page.getByPlaceholder('PROVIDER_TEAM_KEY', { exact: true })).toHaveCount(0)

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await body.evaluate((element) => { element.scrollTop = 0 })
    const [panelBox, footerBox] = await Promise.all([panel.boundingBox(), footer.boundingBox()])
    expect(panelBox, `${viewport.width}x${viewport.height} panel`).not.toBeNull()
    expect(footerBox, `${viewport.width}x${viewport.height} footer`).not.toBeNull()
    expect(panelBox!.x).toBeGreaterThanOrEqual(7)
    expect(panelBox!.y).toBeGreaterThanOrEqual(7)
    expect(panelBox!.x + panelBox!.width).toBeLessThanOrEqual(viewport.width - 7)
    expect(panelBox!.y + panelBox!.height).toBeLessThanOrEqual(viewport.height - 7)
    expect(footerBox!.y + footerBox!.height).toBeLessThanOrEqual(viewport.height - 7)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)

    await body.evaluate((element) => { element.scrollTop = element.scrollHeight })
    await expect(key, `${viewport.width}x${viewport.height} API key after body scroll`).toBeVisible()
    await expect(page.getByText('Encrypted for your OS account', { exact: false })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Create', exact: true })).toBeVisible()
  }
})
