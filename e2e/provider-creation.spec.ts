/** Rendered acknowledgement and one-time-secret recovery for provider onboarding. */
import { test, expect, type Page } from '@playwright/test'
import type { Identity, ModelProvider } from '../contract/index.ts'
import { providerCreationId } from '../server/providerCreationIdentity.ts'
import { ms } from './budget.ts'

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

  await failed.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Connect your session' })).toBeVisible()
  expect(keys[0]).not.toBe('')
  expect(keys[1]).toBe(keys[0])
  const expectedId = providerCreationId(await tenantId(page), keys[0]!)
  expect((await providers(page)).filter((provider) => provider.id === expectedId)).toHaveLength(1)
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
