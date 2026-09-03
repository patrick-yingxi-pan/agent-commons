/** Rendered dual-revision consent, dependency recovery, early-absence retention,
 * and desktop credential cleanup for Provider removal. */
import { test, expect, type Page } from '@playwright/test'
import {
  DEFAULT_PROVIDER_ID,
  type Agent,
  type ModelProvider,
} from '../contract/index.ts'
import { SP_DEFAULT_ID } from '../server/data/prompts.ts'
import { ms } from './budget.ts'

async function createProvider(page: Page, label: string): Promise<ModelProvider> {
  const response = await page.request.post('/api/v1/providers', {
    data: { label, modelFamily: 'claude', effortLevels: ['Low', 'High'] },
  })
  expect(response.ok()).toBe(true)
  return response.json() as Promise<ModelProvider>
}

async function confirmRemoval(page: Page, provider: ModelProvider) {
  await page.goto(`/models/${encodeURIComponent(provider.id)}`)
  await expect(page.getByRole('heading', { name: provider.label, exact: true }))
    .toBeVisible({ timeout: ms(20_000) })
  await page.getByRole('button', { name: 'Remove provider', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: `Remove ${provider.label}?`, exact: true })
  await expect(dialog).toContainText('server-side connection')
  await expect(dialog).toContainText('fall back to their Agent’s provider')
  await expect(dialog).toContainText('lose their selected model')
  await expect(dialog).toContainText('credential stored on this device is erased')
  return dialog
}

function installCredentialBridge(page: Page, failUntilAllowed = false) {
  return page.addInitScript((initiallyBlocked) => {
    ;(window as any).__providerCredentialRemovals = []
    ;(window as any).__allowProviderCredentialRemoval = !initiallyBlocked
    Object.defineProperty(window, 'agentCommonsDesktop', {
      configurable: true,
      value: {
        credentials: {
          provision: async () => 'PROVIDER_DESKTOP_TEST_REFERENCE_12345678',
          bind: async () => undefined,
          discard: async () => undefined,
          removeProvider: async (providerId: string) => {
            ;(window as any).__providerCredentialRemovals.push(providerId)
            if (!(window as any).__allowProviderCredentialRemoval) {
              throw new Error('simulated device vault failure')
            }
          },
        },
      },
    })
  }, failUntilAllowed)
}

test('Provider removal confirms scope and retries changed definition truth under one key', async ({ page }) => {
  test.setTimeout(ms(45_000))
  const provider = await createProvider(page, `Removal Provider ${Date.now().toString(36)}`)
  const remoteFamily = `remote-${Date.now().toString(36)}`
  const bodies: Record<string, unknown>[] = []
  const keys: string[] = []
  let attempts = 0
  await page.route(`**/api/v1/providers/${provider.id}`, async (route) => {
    if (route.request().method() !== 'DELETE') return route.continue()
    attempts += 1
    bodies.push(route.request().postDataJSON() as Record<string, unknown>)
    keys.push(route.request().headers()['idempotency-key'] ?? '')
    if (attempts === 1) {
      const changed = await page.request.patch(`/api/v1/providers/${provider.id}`, {
        data: { modelFamily: remoteFamily, expectedRevision: 0 },
      })
      expect(changed.status()).toBe(200)
    }
    await route.continue()
  })

  let dialog = await confirmRemoval(page, provider)
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused()
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  dialog = await confirmRemoval(page, provider)
  await dialog.getByRole('button', { name: 'Remove provider', exact: true }).click()

  const failed = page.locator('[data-provider-deletion="failed"]')
  await expect(failed).toContainText('changed elsewhere')
  const detail = page.locator('[data-resource-page][data-resource-nature="atomic"]')
  await expect(detail).toHaveAttribute('aria-busy', 'true')
  await expect(detail).toContainText(remoteFamily)
  await expect(page.getByRole('button', { name: 'Edit provider', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Remove provider', exact: true })).toBeDisabled()
  expect(bodies[0]).toMatchObject({ expectedDefinitionRevision: 0, expectedConnectionRevision: 0 })

  await failed.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(page).toHaveURL(/\/models$/)
  expect(attempts).toBe(2)
  expect(keys[0]).not.toBe('')
  expect(keys[1]).toBe(keys[0])
  expect(bodies[1]).toMatchObject({ expectedDefinitionRevision: 1, expectedConnectionRevision: 0 })
  expect((await page.request.get(`/api/v1/providers/${provider.id}`)).status()).toBe(404)
})

test('a Provider remains held until its Agent is repointed and dependency Retry succeeds', async ({ page }) => {
  test.setTimeout(ms(45_000))
  const provider = await createProvider(page, `Bound Provider ${Date.now().toString(36)}`)
  const agentResponse = await page.request.post('/api/v1/agents', {
    data: {
      label: `Provider binder ${Date.now().toString(36)}`,
      providerId: provider.id,
      systemPromptId: SP_DEFAULT_ID,
      tools: [],
    },
  })
  expect(agentResponse.ok()).toBe(true)
  const agent = await agentResponse.json() as Agent
  const bodies: Record<string, unknown>[] = []
  const keys: string[] = []
  await page.route(`**/api/v1/providers/${provider.id}`, async (route) => {
    if (route.request().method() === 'DELETE') {
      bodies.push(route.request().postDataJSON() as Record<string, unknown>)
      keys.push(route.request().headers()['idempotency-key'] ?? '')
    }
    await route.continue()
  })

  const dialog = await confirmRemoval(page, provider)
  await dialog.getByRole('button', { name: 'Remove provider', exact: true }).click()
  const failed = page.locator('[data-provider-deletion="failed"]')
  await expect(failed).toContainText('An Agent still uses this Provider')
  await expect(failed).toContainText('Repoint its model provider, then Retry')

  const repointed = await page.request.patch(`/api/v1/agents/${agent.id}`, {
    data: { providerId: DEFAULT_PROVIDER_ID, expectedRevision: agent.revision ?? 0 },
  })
  expect(repointed.ok()).toBe(true)
  await failed.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(page).toHaveURL(/\/models$/)
  expect(bodies).toHaveLength(2)
  expect(bodies[1]).toEqual(bodies[0])
  expect(keys[1]).toBe(keys[0])
})

test('a committed Provider remains visible while a lost response is reconciled and its device key erased', async ({ page }) => {
  test.setTimeout(ms(45_000))
  await installCredentialBridge(page)
  const provider = await createProvider(page, `Lost Provider removal ${Date.now().toString(36)}`)
  let attempts = 0
  let releaseReconciliation!: () => void
  let markReconciliationStarted!: () => void
  const reconciliationStarted = new Promise<void>((resolve) => { markReconciliationStarted = resolve })
  const reconciliationRelease = new Promise<void>((resolve) => { releaseReconciliation = resolve })
  await page.route(`**/api/v1/providers/${provider.id}`, async (route) => {
    if (route.request().method() === 'DELETE') {
      attempts += 1
      const committed = await route.fetch()
      expect(committed.ok()).toBe(true)
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'internal', message: 'Acknowledgement lost.' } }),
      })
      return
    }
    if (route.request().method() === 'GET') {
      markReconciliationStarted()
      await reconciliationRelease
    }
    await route.continue()
  })

  const dialog = await confirmRemoval(page, provider)
  await dialog.getByRole('button', { name: 'Remove provider', exact: true }).click()
  await reconciliationStarted
  const detail = page.locator('[data-resource-page][data-resource-nature="atomic"]')
  await expect(detail).toHaveAttribute('aria-busy', 'true')
  await expect(detail).toContainText('Removing Provider…')
  const authoritative = await (await page.request.get('/api/v1/providers')).json() as ModelProvider[]
  expect(authoritative.some((candidate) => candidate.id === provider.id)).toBe(false)

  releaseReconciliation()
  await expect(page).toHaveURL(/\/models$/)
  expect(attempts).toBe(1)
  expect(await page.evaluate(() => (window as any).__providerCredentialRemovals))
    .toEqual([provider.id])
})

test('device-vault cleanup failure stays explicit and Retry does not repeat server deletion', async ({ page }) => {
  test.setTimeout(ms(45_000))
  await installCredentialBridge(page, true)
  const provider = await createProvider(page, `Credential cleanup ${Date.now().toString(36)}`)
  let attempts = 0
  await page.route(`**/api/v1/providers/${provider.id}`, async (route) => {
    if (route.request().method() === 'DELETE') attempts += 1
    await route.continue()
  })

  const dialog = await confirmRemoval(page, provider)
  await dialog.getByRole('button', { name: 'Remove provider', exact: true }).click()
  const failed = page.locator('[data-provider-deletion="failed"]')
  await expect(failed).toContainText('Provider is removed')
  await expect(failed).toContainText('could not erase its stored credential')
  await expect(failed).toContainText('startup reconciliation')
  await expect(page.locator('[data-resource-page][data-resource-nature="atomic"]'))
    .toHaveAttribute('aria-busy', 'true')
  expect((await page.request.get(`/api/v1/providers/${provider.id}`)).status()).toBe(404)
  expect(attempts).toBe(1)

  await page.evaluate(() => { (window as any).__allowProviderCredentialRemoval = true })
  await failed.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(page).toHaveURL(/\/models$/)
  expect(attempts).toBe(1)
  expect(await page.evaluate(() => (window as any).__providerCredentialRemovals))
    .toEqual([provider.id, provider.id, provider.id])
})
