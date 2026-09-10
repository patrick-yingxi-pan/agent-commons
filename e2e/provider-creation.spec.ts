/** Rendered acknowledgement and one-time-secret recovery for provider onboarding. */
import { test, expect, type Locator, type Page } from '@playwright/test'
import { join } from 'node:path'
import type { Identity, ModelProvider } from '../contract/index.ts'
import { providerCreationId } from '../server/providerCreationIdentity.ts'
import { ms } from './budget.ts'

const VIEWPORTS = [
  { width: 320, height: 700 },
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 844, height: 390 },
  { width: 1280, height: 800 },
]
const REVIEW_DIR = join(process.cwd(), '.data', 'provider-onboarding-review')

const capture = (page: Page, name: string) =>
  page.screenshot({ path: join(REVIEW_DIR, `${name}.png`), fullPage: false })

async function expectContainedDialog(page: Page, dialog: Locator) {
  const panel = dialog.locator('[data-bounded-dialog]')
  const footer = panel.locator(':scope > div').last()
  // setViewportSize acknowledges the viewport, not the resize listener and
  // ResizeObserver that update the dialog's live workspace bound. Poll the
  // same strict geometry rather than sampling the previous tier's height.
  await expect.poll(async () => {
    const viewport = page.viewportSize()!
    const workspace = await page.locator('[data-popover-viewport]').boundingBox()
    const boxes = await Promise.all([panel.boundingBox(), footer.boundingBox()])
    return boxes.every((box) => box !== null && box.x >= 7
      && box.y >= (workspace?.y ?? 0) + 7
      && box.x + box.width <= viewport.width - 7
      && box.y + box.height <= viewport.height - 7)
  }, 'panel and footer settle inside the live workspace and viewport').toBe(true)
}

async function tenantId(page: Page): Promise<string> {
  const response = await page.request.get('/api/v1/me')
  expect(response.ok()).toBe(true)
  return ((await response.json()) as Identity).tenant.id
}

async function providers(page: Page): Promise<ModelProvider[]> {
  const response = await page.request.get('/api/v1/providers')
  expect(response.ok()).toBe(true)
  return response.json() as Promise<ModelProvider[]>
}

async function openSessionProviderDialog(page: Page, label: string) {
  await page.goto('/models')
  await page.getByRole('button', { name: 'New provider', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'New provider' })
  await dialog.getByRole('button', { name: 'My AI session', exact: true }).click()
  await dialog.getByLabel('Name').fill(label)
  return dialog
}

test('provider fields stay held and Retry preserves one logical create identity', async ({ page }) => {
  test.setTimeout(ms(45_000))
  const label = `Held relay ${Date.now().toString(36)}`
  const keys: string[] = []
  let attempts = 0
  await page.route('**/api/v1/providers', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    attempts += 1
    keys.push(route.request().headers()['idempotency-key'] ?? '')
    if (attempts === 1) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'internal', message: 'Simulated pre-commit failure.' } }),
      })
      return
    }
    await route.continue()
  })

  const dialog = await openSessionProviderDialog(page, label)
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()
  const failed = page.locator('[data-provider-creation="failed"]')
  await expect(failed).toContainText('Couldn’t confirm the provider')
  await expect(dialog).toBeVisible()
  await expect(dialog).toHaveAttribute('aria-busy', 'true')
  await expect(dialog.getByLabel('Name')).toHaveValue(label)
  await expect(dialog.getByLabel('Name')).toBeDisabled()

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await expectContainedDialog(page, dialog)
    await capture(page, `session-held-${viewport.width}x${viewport.height}`)
  }

  await failed.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Connect your session' })).toBeVisible()
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    const reveal = page.getByRole('dialog', { name: 'Connect your session' })
    await expect(reveal).toBeVisible()
    await expectContainedDialog(page, reveal)
    await capture(page, `session-reveal-${viewport.width}x${viewport.height}`)
  }
  expect(keys[0]).not.toBe('')
  expect(keys[1]).toBe(keys[0])
  const expectedId = providerCreationId(await tenantId(page), keys[0]!)
  expect((await providers(page)).filter((provider) => provider.id === expectedId)).toHaveLength(1)
  await page.setViewportSize({ width: 844, height: 390 })
  const reveal = page.getByRole('dialog', { name: 'Connect your session' })
  await reveal.getByRole('button', { name: 'Copy bootstrap prompt', exact: true }).click()
  await expect(reveal.getByRole('button', { name: 'Done', exact: true })).toBeEnabled()
  await reveal.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(reveal).toHaveCount(0)
})

test('a committed Session provider with a lost response recovers its secret without duplication', async ({ page }) => {
  test.setTimeout(ms(45_000))
  const label = `Recovered relay ${Date.now().toString(36)}`
  const keys: string[] = []
  let attempts = 0
  await page.route('**/api/v1/providers', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    attempts += 1
    keys.push(route.request().headers()['idempotency-key'] ?? '')
    if (attempts === 1) {
      const committed = await route.fetch()
      expect(committed.ok()).toBe(true)
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'internal', message: 'Acknowledgement lost after commit.' } }),
      })
      return
    }
    await route.continue()
  })

  const dialog = await openSessionProviderDialog(page, label)
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Connect your session' })).toBeVisible()
  expect(attempts).toBe(2)
  expect(keys[0]).not.toBe('')
  expect(keys[1]).toBe(keys[0])
  const expectedId = providerCreationId(await tenantId(page), keys[0]!)
  expect((await providers(page)).filter((provider) => provider.id === expectedId)).toHaveLength(1)
  await expect(page.locator('[data-provider-creation="failed"]')).toHaveCount(0)
})

test('Session provider creation is ready when the New provider form is usable', async ({ page }) => {
  test.setTimeout(ms(45_000))
  const label = `Ready relay ${Date.now().toString(36)}`
  const pageErrors: Error[] = []
  const runtimeRequests: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error))

  const dialog = await openSessionProviderDialog(page, label)
  await page.route('**/src/controller/providerCreationMutationRuntime.ts*', async (route) => {
    runtimeRequests.push(route.request().url())
    await route.abort()
  })

  await dialog.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Connect your session' })).toBeVisible()
  expect(pageErrors).toHaveLength(0)
  expect(runtimeRequests).toHaveLength(0)
})
